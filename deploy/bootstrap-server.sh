#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  bootstrap-server.sh — corre UNA vez en el servidor Fedora como root/sudo
#
#  Hace:
#    1. Crea usuario `deploy` (sin shell login interactivo, solo docker)
#    2. Lo añade al grupo docker
#    3. Crea /opt/mundial2026 y se lo da
#    4. Instala fail2ban + crowdsec-firewall-bouncer
#    5. Configura firewalld
#
#  Uso:
#    sudo bash deploy/bootstrap-server.sh
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ Corre con sudo"; exit 1
fi

echo "→ 1/5  Crear usuario 'deploy'"
if ! id deploy &>/dev/null; then
  useradd -m -s /bin/bash deploy
  usermod -aG docker deploy
fi
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

echo "→ 2/5  /opt/mundial2026"
mkdir -p /opt/mundial2026
chown deploy:deploy /opt/mundial2026

echo "→ 3/5  firewalld"
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
# Si vas a usar puertos no-estándar (9080/9443), añádelos:
# firewall-cmd --permanent --add-port=9080/tcp
# firewall-cmd --permanent --add-port=9443/tcp
firewall-cmd --reload

echo "→ 4/5  fail2ban"
dnf install -y fail2ban
systemctl enable --now fail2ban

echo "→ 5/5  CrowdSec firewall bouncer (host-level)"
# Repo oficial CrowdSec
curl -s https://install.crowdsec.net | bash
dnf install -y crowdsec-firewall-bouncer-nftables

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  ✅ Bootstrap completo."
echo ""
echo "  Próximos pasos:"
echo "  1. Añade tu clave pública SSH a /home/deploy/.ssh/authorized_keys"
echo "  2. Sube el repo a /opt/mundial2026 (git clone o rsync)"
echo "  3. cp .env.prod.example .env.prod && edita los secrets"
echo "  4. cd /opt/mundial2026 && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d"
echo "  5. bash docker/crowdsec/setup-bouncer.sh   # genera la API key del bouncer"
echo "  6. Pega la key en /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml"
echo "  7. systemctl enable --now crowdsec-firewall-bouncer"
echo "═══════════════════════════════════════════════════════════════════"
