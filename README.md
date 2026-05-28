# Mundial 2026 — Backend

NestJS + Prisma + PostgreSQL · Dockerizado · CrowdSec WAF · CI/CD a Fedora

```
app.esppapel.com:9443 (HTTPS)
   ↓
Nginx (TLS + rate-limit + WAF bouncer)
   ↓
NestJS backend (esta imagen)
   ↓
PostgreSQL (red docker interna, no expuesta a internet)
```

## Producción

`git push origin main` → GitHub Actions build → push a GHCR → SSH al Fedora → `docker compose pull && up -d`.

Ver `.github/workflows/deploy.yml` y `deploy/bootstrap-server.sh`.

## Local dev (sin Docker)

```bash
npm install
cp .env.example .env
npm run start:dev
```
