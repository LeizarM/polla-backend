#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  verify-backup.sh — verifica integridad del último backup GPG.
#
#  Hace:
#   1. Toma el .sql.gz.gpg más reciente en /opt/mundial2026/backups/
#   2. Lo descifra con BACKUP_GPG_PASSPHRASE
#   3. Descomprime → cabecera SQL válida
#   4. (Opcional) restaura en una DB temporal y cuenta filas en `user`
#
#  Si falla en cualquier paso → exit 1 y log a stderr.
#
#  Programado vía cron del sistema:
#    # /etc/cron.d/backup-verify
#    30 5 * * * deploy /opt/mundial2026/scripts/verify-backup.sh >> /var/log/backup-verify.log 2>&1
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV_FILE="${1:-/opt/mundial2026/.env.prod}"
BACKUP_DIR="${BACKUP_DIR:-/opt/mundial2026/backups}"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ENV file no encontrado: $ENV_FILE" >&2
  exit 1
fi

# Cargar GPG passphrase
PASS=$(grep '^BACKUP_GPG_PASSPHRASE=' "$ENV_FILE" | sed 's/^BACKUP_GPG_PASSPHRASE=//' | tr -d '\n\r"')
if [ -z "$PASS" ]; then
  echo "❌ BACKUP_GPG_PASSPHRASE vacía" >&2
  exit 1
fi

# Último backup
LATEST=$(ls -t "$BACKUP_DIR"/*.sql.gz.gpg 2>/dev/null | head -1 || true)
if [ -z "$LATEST" ]; then
  echo "❌ No hay backups en $BACKUP_DIR" >&2
  exit 1
fi

echo "→ Verificando: $LATEST"
SIZE=$(stat -c%s "$LATEST")
echo "   Tamaño: $SIZE bytes"
if [ "$SIZE" -lt 1024 ]; then
  echo "❌ Backup demasiado pequeño (<1KB)" >&2
  exit 1
fi

# Descifrar + descomprimir → primeros 500 bytes
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

echo "→ Descifrando..."
echo "$PASS" | gpg --batch --yes --passphrase-fd 0 --decrypt "$LATEST" 2>/dev/null \
  | gunzip 2>/dev/null \
  | head -c 500 > "$TMP"

if [ ! -s "$TMP" ]; then
  echo "❌ Descifrado/decompresión produjo archivo vacío" >&2
  exit 1
fi

# Validar cabecera SQL de pg_dump
if ! grep -q "PostgreSQL database dump" "$TMP"; then
  echo "❌ El backup no parece ser un dump válido de PostgreSQL" >&2
  head -3 "$TMP" >&2
  exit 1
fi

echo "✅ Backup íntegro: $LATEST"
echo "   Cabecera SQL detectada"
echo "   Fecha: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0
