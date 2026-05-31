#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  rotate-jwt-secret.sh
#
#  Rota el JWT_SECRET en .env.prod. Invalida TODOS los tokens actuales
#  → los usuarios deben re-loguearse en su próxima request.
#
#  Recomendado correr cada 90 días desde un cron del sistema:
#
#    # En /etc/cron.d/jwt-rotate (corre el 1ro de cada 3er mes)
#    0 4 1 */3 * deploy /opt/mundial2026/scripts/rotate-jwt-secret.sh
#
#  Uso manual:
#    ssh deploy@server
#    cd /opt/mundial2026
#    bash scripts/rotate-jwt-secret.sh
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV_FILE="${1:-/opt/mundial2026/.env.prod}"
COMPOSE="/opt/mundial2026/docker-compose.prod.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE no encontrado"; exit 1
fi

NEW_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Backup del .env actual
cp "$ENV_FILE" "$ENV_FILE.$(date +%Y%m%d_%H%M%S).bak"

# Reemplaza o añade JWT_SECRET
if grep -q '^JWT_SECRET=' "$ENV_FILE"; then
  # En lugar de usar sed (puede chocar con caracteres especiales en el secret),
  # reescribimos el archivo línea por línea
  awk -v new="$NEW_SECRET" '/^JWT_SECRET=/ { print "JWT_SECRET="new; next } { print }' "$ENV_FILE" > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
else
  echo "JWT_SECRET=$NEW_SECRET" >> "$ENV_FILE"
fi

# Actualiza/añade JWT_LAST_ROTATION
if grep -q '^JWT_LAST_ROTATION=' "$ENV_FILE"; then
  awk -v ts="$NOW_ISO" '/^JWT_LAST_ROTATION=/ { print "JWT_LAST_ROTATION="ts; next } { print }' "$ENV_FILE" > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
else
  echo "JWT_LAST_ROTATION=$NOW_ISO" >> "$ENV_FILE"
fi

chmod 600 "$ENV_FILE"

echo "✅ JWT_SECRET rotado en $NOW_ISO"
echo "   Backup en: $ENV_FILE.$(date +%Y%m%d)*.bak"

# Restart backend para tomar el nuevo secret
if [ -f "$COMPOSE" ]; then
  echo "→ Reiniciando backend..."
  docker compose -f "$COMPOSE" --env-file "$ENV_FILE" restart backend
  sleep 5
  echo "→ Verificando health..."
  curl -sk https://localhost:9443/health || echo "⚠️  health no respondió"
  echo ""
  echo "✅ Backend reiniciado. Todos los usuarios deben re-loguearse."
fi
