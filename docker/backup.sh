#!/bin/sh
# ────────────────────────────────────────────────────────────────────────
#  Daily encrypted Postgres backup → /backups/mundial2026-YYYYMMDD.sql.gz.gpg
#  - Compresses with gzip
#  - Encrypts symmetrically with GPG (AES256) using BACKUP_GPG_PASSPHRASE
#  - Keeps last 14 backups, deletes older
#
#  Restore:
#    gpg --decrypt --batch --passphrase "$PASS" backup.sql.gz.gpg | gunzip | psql ...
# ────────────────────────────────────────────────────────────────────────
set -euo pipefail

TS=$(date +%Y%m%d-%H%M%S)
OUT="/backups/mundial2026-${TS}.sql.gz.gpg"

echo "[backup] Dumping DB to ${OUT}"

pg_dump --host=db --no-owner --no-privileges --format=plain "${PGDATABASE}" \
  | gzip -9 \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase "${BACKUP_GPG_PASSPHRASE}" \
        --output "${OUT}"

# Retention: keep last 14 days
find /backups -name 'mundial2026-*.sql.gz.gpg' -type f -mtime +14 -delete

echo "[backup] OK $(ls -lh ${OUT} | awk '{print $5}')"
