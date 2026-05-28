#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
#  Genera la API key para que el firewall-bouncer del host pueda
#  comunicarse con CrowdSec corriendo en docker.
#  Correr UNA VEZ después del primer `docker compose up -d`.
#
#  Output: imprime la BOUNCER_KEY que debes pegar en /etc/crowdsec/bouncers/*.yaml
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

echo "→ Registrando bouncer 'firewall-bouncer' en CrowdSec…"
KEY=$(docker compose -f "$COMPOSE_FILE" exec -T crowdsec \
  cscli bouncers add firewall-bouncer -o raw)

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Pega esta API key en /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml:"
echo ""
echo "  api_key: $KEY"
echo "  api_url: http://127.0.0.1:8080/"
echo "═══════════════════════════════════════════════════════════════"
