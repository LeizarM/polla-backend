# CLAUDE.md — Backend (polla-backend · Mundial 2026)

Orienta a Claude Code al trabajar en el **backend**. La documentación COMPLETA del proyecto
entero (backend, frontend, base de datos, Firebase/notificaciones, infra, deploy, y los
checklists para **bajar/subir de producción**) está en **`PROJECT_HANDBOOK.md`** (en este mismo
repo). Leé el handbook para reactivación o contexto profundo; este archivo es el resumen operativo.

## Estado del proyecto
**ARCHIVADO** tras un Mundial 2026 exitoso (salieron 9 ganadores). Se baja de producción para
revivirlo en el próximo Mundial/polla (dentro de mucho tiempo). Para **bajarlo** y **volverlo a
subir igual que ahora**, seguir `PROJECT_HANDBOOK.md` **§10 (bajar)** y **§11 (reactivar)**.

## Qué es este repo
Backend **NestJS 11 + Prisma 6 + PostgreSQL 16** (yarn 4) de una app de quinielas del Mundial.
El frontend (Expo/RN) vive en el repo hermano `react_native_space` (`LeizarM/polla-frontend`).
Este repo es `LeizarM/polla-backend`. **No hay wallet real** — los pagos son offline; la moneda
mostrada es `Bs`.

## Comandos
```bash
yarn start:dev            # nest start --watch
yarn build               # → dist/
yarn lint                # eslint --fix
yarn test                # jest (tests junto al código, *.spec.ts, rootDir src)
yarn prisma db push      # sincroniza esquema (prod y dev usan db push, NO migrate deploy)
yarn prisma db seed      # → scripts/safe-seed.ts (guard) → scripts/seed.ts
```
Env dev (`.env`): `DATABASE_URL` (obligatoria), `JWT_SECRET`, `CORS_ORIGINS`, `ENABLE_SWAGGER`,
`SEED_ADMIN_PASSWORD`/`SEED_USER_PASSWORD`. Prod: ver handbook §8.2.

## Reglas críticas / gotchas (no romper)
- **Codificación de picks/resultados: `L`/`E`/`V`** (Local/Empate/Visitante), NO a/b/draw.
- **`functions.sql` está MUERTO** (triggers no instalados, su instalador está roto, usan a/b/draw).
  TODA la lógica de resultados/premios está en TypeScript. Única función SQL viva: `resolve_group`.
- **`prisma db push --accept-data-loss`** corre al arrancar en prod → limpiar dato sucio ANTES de
  subir un constraint nuevo o el deploy se rompe. Prod NO usa migraciones.
- **`WalletModule` NO está montado** en `AppModule` (endpoints de wallet/QR/upload muertos).
  `balance`/`transaction`/`house_cut_pct`/`min_bet`/`max_bet` son **legado**.
- **JWT dura 35 días** (hardcodeado en `AuthModule`, ignora `JWT_EXPIRES_IN`).
- **`JWT_SECRET` ≥16 chars o el server NO arranca** (fail-closed).
- **Guards:** `JwtAuthGuard` re-verifica el user en BD (caché 60s) e inyecta el `role` REAL de BD;
  `AdminGuard` depende de que corra antes. `CronAuthGuard` para `/api/cron/*` (`X-Cron-Secret`).
  `FreshAuthGuard` existe pero NO se usa. 2FA (TOTP) con anti-replay; en código NO se restringe a
  admins (es convención de producto). Lockout de login **persistido** (`failed_login_attempts`/`locked_until`).
- **Enrollment gate:** solo `tournament_participant.status='approved'` apuesta y cuenta al pozo.

## Reglas de negocio (respetar en código nuevo)
- **Pozo jornada** = `bet_per_matchday × inscritos_aprobados` (todos aportan, apuesten o no).
  No-apostadores reciben **ghost tickets** (`amount_bet=0, status=lost`) al resolver. Ganan los de
  **más aciertos**; empate reparte parejo. Sin house cut.
- **Polla Final:** picks 1º-4º SOLO de equipos `advanced_to_quarters`; **repetidos permitidos**;
  puntaje **12/8/4/2** por posición exacta; **pozo** = `jornadas × inscritos_aprobados × bet_final`;
  bloqueada (crear+editar) tras `final_bet_deadline`; **picks ofuscados** en el reporte hasta el
  deadline (comparación por instante UTC).
- **Lock por-partido (NO por-jornada):** cada match se sella cuando `match_date <= now`.
- **`advanced_team_id`** (avance de fase): solo eliminación (ambos equipos en cuartos); aparte del
  `result` de 90' (que es el de la apuesta). Validado en `matches.service.updateScores`.
- `user.ci` obligatorio pero **NO único** (familias comparten). Solo `username` es único.

## Arquitectura (rápido)
18 módulos feature (`auth`, `users`, `teams`, `tournaments`, `tournament-participants`, `matchdays`,
`matches`, `tickets`, `groups`, `group-bets`, `final-bets`, `wallet`[desmontado], `reports`,
`notifications`, `settings`, `audit`, `admin`, `prisma`, `common`). `main.ts`: trust proxy, Helmet
(CSP off en dev), CORS allowlist en prod (sin `*`), ValidationPipe whitelist, body 1MB, Throttler
(60/s·400/10s·2000/min + overrides login/signup), Swagger solo si no-prod o `ENABLE_SWAGGER`.
Notificaciones: cron in-proceso (`schedules.service`, `@Cron` cada min, tabla `notification_schedule`)
+ Web Push VAPID + Expo Push. Detalle completo: `PROJECT_HANDBOOK.md` §3 y §6.

## Deploy
`git push origin main` (dentro de este subdir) → CI `deploy.yml` auto-despliega (build → GHCR →
SSH `deploy@app.esppapel.com` → `docker compose pull && up -d` → `prisma db push` → `/health`).
SQL en prod: `docker exec mundial2026-db-1 bash -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "..."'`
(`user` es reservada → escapar `\"user\"`). Ver handbook §7/§10/§11.

## Idioma
Todo en español (UI, comentarios, commits). Mantener ese estilo.
Commits terminan con: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
