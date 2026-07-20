# PROJECT HANDBOOK — Mundial 2026 / Polla ESP

> **Manual de reactivación.** Este documento describe TODO el proyecto (backend, base de
> datos, frontend, Firebase/notificaciones, infraestructura y despliegue) con el detalle
> necesario para **bajarlo de producción** y **revivirlo en el próximo Mundial** dentro de
> años, aunque quien lo lea no recuerde nada. Idioma del proyecto: español.
>
> Complementa (no reemplaza) a: `CLAUDE.md`, `DEPLOY.md`, `api_design.md`, `db_design.md`,
> `ux_design.md`. Ante duda, el **código es la fuente de verdad**.

---

## 0. LEER PRIMERO — las 12 cosas que rompen una reactivación

1. **Secretos y datos NO están en git.** Antes de apagar, respaldá EXTERNAMENTE: `.env.prod`
   (incluye `BACKUP_GPG_PASSPHRASE`, `JWT_SECRET`, `POSTGRES_PASSWORD`, `VAPID_*`), la carpeta
   `backups/` y el volumen Docker `pgdata`. Sin la passphrase GPG, los backups son **irrecuperables**.
2. **Certificados Let's Encrypt caducan a los 90 días** → al reactivar hay que **re-emitirlos** sí o sí.
3. **SSL pinning del APK expira `2027-01-01`.** Si reactivás ANTES de esa fecha con un cert de otra
   CA, los APK viejos **rompen la conexión** → hay que rebuildear el APK (OTA no alcanza, es nativo).
4. **`prisma db push --accept-data-loss` corre en cada arranque del backend.** Limpiá datos "sucios"
   ANTES de subir un constraint nuevo o el arranque falla / borra columnas.
5. **Hay DOS `docker-compose.prod.yml`** (raíz y `nodejs_space/`) que difieren. Capturá el que
   realmente está en `/opt/mundial2026` antes de tocar nada (el CI/CD sobreescribe el de la raíz).
6. **Codificación de picks/resultados: `L`/`E`/`V`** (Local/Empate/Visitante), NO a/b/draw.
7. **`functions.sql` (triggers SQL) está MUERTO.** Toda la lógica de resultados/premios está en
   TypeScript. No hace falta instalarlo (y su instalador está roto).
8. **`WalletModule` está desmontado** (no importado en `AppModule`) → no hay flujo de dinero real;
   los pagos son offline. `balance`/`transaction` son legado.
9. **JWT dura 35 días** (hardcodeado en `AuthModule`, ignora `JWT_EXPIRES_IN`).
10. **`CRON_SECRET` NO está en `.env.prod.example`** — agregarla a mano (≥16 chars) si se usan los
    recordatorios push por endpoint externo.
11. **CrowdSec en prod solo aplica la blocklist global (CAPI)** — la detección por logs de Nginx está
    desactivada a propósito (acquisition → `/dev/stdout`).
12. **Nginx tiene el dominio `app.esppapel.com` y las rutas del cert HARDCODEADOS** en
    `docker/nginx/conf.d/app.conf` (no usa `DOMAIN`). Con otro dominio, editar a mano.

---

## 1. Visión general y arquitectura

**Qué es:** app de quinielas/pollas para un Mundial de fútbol (pensada para una oficina en Bolivia).
Los usuarios apuestan el resultado (L/E/V) de los partidos de cada **jornada** y arman una **Polla
Final** (predicción del podio 1º-4º). El dinero se cobra **offline**; la app no mueve plata.

**Dos repos independientes** (cada uno con su propio `.git`; commitear dentro de cada subcarpeta):

| Repo | Path local | Stack | GitHub |
|---|---|---|---|
| Backend | `nodejs_space/` | NestJS 11 · Prisma 6 · PostgreSQL 16 · yarn 4 | `LeizarM/polla-backend` |
| Frontend | `react_native_space/` | Expo 54 · RN 0.81 · Expo Router · yarn 4 (iOS/Android/Web) | `LeizarM/polla-frontend` |

**Infra** (raíz `NEWPolla/`): `docker/`, `deploy/`, `docker-compose*.yml`, `DEPLOY.md`, `.github/workflows/`.

**Producción:**
- Backend + DB en un host **Fedora** (`app.esppapel.com`), en Docker, detrás de Nginx en **`:9443`**
  (HTTPS) y **`:9080`** (ACME/redirect). Los puertos `:443`/`:8443` los usa **otra app ajena** en el
  mismo host → por eso puertos altos. Directorio: `/opt/mundial2026` (usuario `deploy`).
- Frontend **web** servido aparte: Plesk en `apuestamundial.impexpap.com` (auto-pull de la rama
  `web-build`), o Nginx propio sirviendo `/opt/mundial2026/frontend-dist`.
- Frontend **móvil**: APK/AAB por EAS; actualizaciones JS por **OTA** (canal `preview`).
- Cuenta EAS/Expo: owner `renmleizar`, slug `polla-frontend`, projectId `64a3d4b2-b4d6-4ff0-8dc5-6f6eed85b8dc`.
- Firebase (solo FCM Android vía Expo): proyecto `polla-esp`, Sender ID `355171610078`.

---

## 2. Topología de producción

```
internet
  │  firewalld (host): abiertos 22, 80, 443, 9080, 9443
  │  CrowdSec firewall-bouncer (host, nftables) → banea IPs (solo blocklist CAPI global)
  ▼
:9080  Nginx HTTP   → ACME + 301 a https://$host:9443
:9443  Nginx HTTPS  → reverse proxy a backend:3000 (TLS 1.2/1.3, HSTS, rate-limit, bloqueo de probes)
  │  red docker `internal`
  ▼
backend:3000  (NestJS, non-root, sin puerto publicado)
  │  red docker `internal`
  ▼
db:5432  (Postgres 16, NO expuesto)
```
Servicios laterales (red `internal`): `certbot` (renovación TLS), `crowdsec`, `db-backup` (GPG diario),
`watchtower` (auto-rota solo el backend por label).
Volúmenes nombrados: `pgdata` (datos), `nginx-logs`, `crowdsec-db`, `crowdsec-config`.
Bind mounts fuera de git: `./backups`, `./docker/certbot/*` (o `/etc/letsencrypt` del host), `.env.prod`.

**Acceso SQL a prod** (la DB no está expuesta): `docker exec mundial2026-db-1 bash -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "..."'`.
No usar `docker compose` desde `~` (no encuentra `.env`). El deploy vive en `/opt/mundial2026`.
`user` es palabra reservada → escapar `\"user\"` en el `-c`.

---

## 3. Backend (NestJS) — `nodejs_space/src`

Prefijo global `api/` (salvo `/` y `/health`). Arranque: `npx prisma db push && node dist/main.js`.

### 3.1 Stack de seguridad global (`main.ts` / `app.module.ts`)
- **`trust proxy = 1`** (Nginx termina TLS; sin esto el rate-limit vería la IP del contenedor).
- **Helmet**: CSP **activa en prod**, **desactivada en dev** (para los scripts inline de Swagger).
- **`Cache-Control: no-store` global** (evita que Safari/proxies sirvan datos de otro usuario al recargar).
  Excepción: el avatar sobreescribe con `max-age=60`.
- **CORS**: prod = **allowlist estricta** desde `CORS_ORIGINS` (CSV, **sin `*`**); apps nativas no mandan
  `Origin` y pasan por `if(!origin)`. Dev = abierto.
- **ValidationPipe** global: `whitelist` + `forbidNonWhitelisted` (400 si mandan props extra) + `transform`.
- **Body limit 1 MB** (JSON/urlencoded).
- **ThrottlerModule** (por IP): 60/1s, 400/10s, 2000/60s + overrides `@Throttle` en login (5/min) y signup (3/min).
- **`ScheduleModule.forRoot()`** — requerido para el cron de notificaciones.
- **`LastSeenInterceptor`** — actualiza `user.last_seen_at` máx. 1/min (vista "usuarios en línea").
- **`GeoFenceMiddleware`** — SOLO en `POST /api/auth/login` y `POST /api/signup` (off por defecto, fail-open).
- **Swagger** en `/api-docs` solo si NO prod o `ENABLE_SWAGGER=true`.
- **`AllExceptionsFilter`**: cualquier error no-HTTP → `{500, "Error interno"}` genérico (nunca filtra stack).
- **`sanitizeUser`**: quita `password/totp_secret/failed_login_attempts/locked_until/avatar(bytes)`, agrega `avatar_url`.

### 3.2 Guards / auth (módulo `auth`, `@Global()`)
- **`JwtStrategy`**: **fail-closed** — si `JWT_SECRET` falta o &lt;16 chars, **no arranca**. `HS256` fijo,
  `ignoreExpiration:false`. Re-consulta el user en BD (rechaza inexistente/`blocked`).
- **`JwtAuthGuard`**: re-verifica estado del user en BD con **caché de 60s**, e **inyecta el `role` REAL de
  BD** (no confía en el rol del JWT) → degradar un admin surte efecto en ≤60s.
- **`AdminGuard`**: 403 si `req.user.role !== 'admin'` (depende de que corra JwtAuthGuard antes).
- **`CronAuthGuard`**: header `X-Cron-Secret == CRON_SECRET` (constant-time, deny-by-default si &lt;16 chars).
- **`FreshAuthGuard`**: existe pero **NO se usa** (se sacó de 2FA/password por el APK).
- **Login**: lockout **persistido en BD** (`failed_login_attempts`/`locked_until`, 5 intentos → 15 min);
  `DUMMY_HASH` bcrypt si el user no existe (anti-enumeración); bcrypt cost 12; password ≥8 + letra + número.
- **2FA (TOTP)**: `otplib`, anti-replay por `totp_last_step`. En login, si `totp_enabled` y no mandan código →
  `{requires_2fa:true}` sin token. **Gotcha:** el código NO restringe 2FA a admins (solo `JwtAuthGuard`);
  el "solo admins" es convención de producto.
- **JWT `expiresIn: '35d'`** hardcodeado en `AuthModule`.

### 3.3 Módulos y endpoints (18 módulos)
Todos requieren `JwtAuthGuard` salvo los marcados **público**; las mutaciones de gestión añaden `AdminGuard`.

**Públicos (sin JWT):** `GET /`, `GET /health` (SkipThrottle), `POST /api/signup`, `POST /api/auth/login`,
`GET /api/settings`, `GET /api/users/:id/avatar`, `GET /api/push/vapid-public-key`.

- **auth**: `POST /api/signup`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/2fa/{setup,enable,disable}`.
- **users**: `GET|PATCH /api/users/me`, `PATCH /api/users/me/password`, `GET /api/users/me/{balance,transactions}`;
  **avatar**: `POST /api/users/me/avatar` (≤500 KB), `GET /api/users/:id/avatar` (**público**, CORP cross-origin).
- **teams**: `GET /api/teams`; `POST|PATCH|DELETE` admin.
- **tournaments**: `GET /api/tournaments` (?status, con `approved_participants`), `GET /:id`,
  `GET /:id/quarter-teams`; admin: `POST`, `PATCH /:id`, `POST /:id/teams` (preserva flags cuartos),
  `PATCH /:id/status`, `PATCH /:id/team-quarters`.
- **tournament-participants** (gate de inscripción): `POST` (admin se auto-aprueba), `GET /me`,
  `GET /tournament/:id` (admin, con PII), `GET /tournament/:id/roster` (sin PII), `PATCH /:id/status`
  (admin — **sin este guard cualquiera se auto-aprobaría**), `POST /admin/enroll`. Al aprobar tarde,
  `proRateLateJoiner` integra retroactivamente al inscrito en jornadas ya resueltas (ghost ticket + reparto).
- **matchdays**: `GET /api/matchdays` (visibilidad "1 día antes" en hora Bolivia; oculta jornadas pasadas al
  inscrito tardío), `GET /:id`, `POST|PATCH` admin, `POST /:id/resolve` (admin), `GET /:id/ranking` (aciertos en
  vivo), `GET /:id/report` (admin), `GET /:id/winners`, `GET /:id/bet-log` (revelado por-partido).
- **matches**: `GET /api/matches`, `GET /:id`, admin: `POST` (bloquea duplicados), `PATCH /:id`,
  `PATCH /:id/scores` (deriva `result` L/E/V + `advanced_team_id` opcional), `DELETE /:id` (bloqueado si hay picks).
- **tickets**: `GET /api/tickets/me`, `GET /:id`, `POST` (crear), `PATCH /:id/picks`;
  `GET /api/matchdays/:id/tickets` (admin). Lock por-partido, monto fijo, anti doble-boleto por índice único.
- **groups** (`group_stage`): `GET /api/groups`, `GET /:id`, admin `POST|PATCH|PATCH /:id/results|POST /:id/resolve`
  (único punto que llama a la función SQL `resolve_group`, con fallback).
- **group-bets** (desactivado en UI): `GET /me`, `POST`, `GET /:id`. **Único flujo que toca `balance`** → en la
  práctica falla por "Insufficient balance" salvo carga manual. Legado.
- **final-bets** (Polla Final): `GET /me`, `POST`, `PATCH /:id`, admin `GET /tournament/:id`, `GET /tournament/:id/report`
  (con ofuscación hasta deadline), `POST /tournament/:id/resolve`. Deadline bloquea crear+editar; picks de cuartos;
  se permiten repetidos; puntaje 12/8/4/2.
- **reports** (PDF con pdfkit): `GET /api/reports/matchday/:id/pdf` (admin), `GET /tournament/:id/accumulated`
  (JSON, valida admin o participante aprobado en el service), `GET /tournament/:id/accumulated/pdf` (admin),
  `GET /tournament/:id/polla-final/pdf` (admin, respeta ofuscación).
- **notifications**: ver §6.
- **settings**: `GET /api/settings` (**público**), `PATCH /api/settings` (admin). Default `polla_final_enabled='false'`.
- **audit** (`@Global()`, fire-and-forget): `GET /api/admin/audit-log` (paginado, filtros), `GET /api/admin/audit-log/actions`.
- **admin**: `GET /api/admin/users` (con `total_won`), `GET /:id`, `GET /api/admin/stats` (dashboard),
  `PATCH /:id/status`, `PATCH /:id/role`, `PATCH /:id/password`.
- **wallet** (⚠️ **NO montado en AppModule** → endpoints muertos): depósitos, QR, upload.

---

## 4. Base de datos (Prisma / PostgreSQL 16)

- **Schema se aplica con `prisma db push`** (dev y prod), NO con `migrate deploy`. Las 4 migraciones son documentales.
- PKs UUID (`uuid_generate_v4()` → requiere extensión `uuid-ossp`, creada por `docker/init.sql`).
- Dinero: `Decimal(12,2)`; timestamps `Timestamptz(6)`; `updated_at` se setea a mano en cada service.
- **20 modelos**. Tablas hijas de `tournament` cascadean al borrar.

### 4.1 Tablas clave (campos no obvios)
- **`user`**: `username` **único** (único identificador único); `ci` obligatorio **NO único** (familias comparten);
  `role` admin/user; `balance`/`status`; TOTP (`totp_secret/enabled/last_step`); anti-brute-force
  (`failed_login_attempts`, `locked_until`); `last_seen_at`; `avatar` (bytea) + `avatar_mime` + `avatar_updated_at`
  (cache-bust); `flip_own_picks` (opt-in ver picks propios sellados).
- **`team`**: `name/country/shield_url`. Catálogo global; se reusa vía `tournament_team`.
- **`tournament`**: `status` draft→active→finished; `bet_per_matchday` (**activo**), `bet_final` (**activo**),
  `currency` "Bs", `final_bet_deadline` (**activo**: bloquea Polla Final + controla ofuscación).
  `house_cut_pct`/`min_bet`/`max_bet` = **legado, no se usan**.
- **`tournament_team`**: `advanced_to_quarters` (bool) — **compuerta de la Polla Final** y del avance de fase.
- **`matchday`**: `date` (día), `status` open→resolved, `total_pool`.
- **`match`**: `score_a/b`, `result` **L/E/V**, `match_date` (hora exacta = reloj del lock por-partido),
  `advanced_team_id` (solo eliminación; quién avanzó real, incluye alargue/penales; se compara vs team_a/b_id).
- **`ticket`**: `amount_bet` (**0 = ghost ticket**), `total_correct`, `prize_won`. **`@@unique(user_id, matchday_id)`**
  = candado anti-doble-boleto (P2002 → mensaje amable).
- **`ticket_pick`**: `pick` **L/E/V**, `is_correct`. `@@unique(ticket_id, match_id)`.
- **`tournament_participant`**: `status` **pending→approved** (solo `approved` apuesta y cuenta al pozo);
  `created_at` = cuándo se inscribió (para ocultar jornadas pasadas al tardío).
- **`final_bet`**: `pick_1st..4th` (de cuartos, **repetidos permitidos**), `total_points`, `prize_won`.
  `@@unique(user_id, tournament_id)`.
- **`tournament_group`/`group_bet`**: fase de grupos (desactivada en UI). `team_ids` es array nativo.
- **`push_token`**: `token` **único**, `device_type` (android/ios/web). Reemplaza `user.fcm_token`.
- **`notification_schedule`** + **`match_reminder_log`** (PK compuesta `(match_id, schedule_id)` = dedupe).
- **`app_setting`** (PK textual `key`), **`audit_log`**, **`qr_code`**, **`news_cache`**, **`transaction`** (legado).

### 4.2 `functions.sql` — MUERTO (importante)
Define triggers `calculate_match_result` (usa **a/b/draw**, no L/E/V), `process_ticket_insert` (descuenta balance
inexistente → rompería todas las apuestas), `resolve_matchday`, etc. **No están instalados**: su instalador
`scripts/setup-db-functions.js` **está roto** (parte por `;` un archivo PL/pgSQL con `$$` internos) y **no se
invoca en ningún flujo**. `prisma db push` no ejecuta `functions.sql`. **Toda la lógica vive en TypeScript.**
La única función SQL aún llamada es `resolve_group` (con fallback si falla).

### 4.3 Seed
`yarn prisma db seed` → `scripts/safe-seed.ts` (**aborta si `seed.ts` contiene `delete`/`deleteMany`** — nunca
debilitar este guard) → `scripts/seed.ts`: crea `admin` + `user1/2/3` (passwords **obligatorias** por
`SEED_ADMIN_PASSWORD`/`SEED_USER_PASSWORD`, bcrypt cost 12) y 6 equipos si la tabla está vacía. Idempotente (upsert).

### 4.4 Resolución de premios (en código)
- **Pozo jornada** = `bet_per_matchday × inscritos_aprobados` (todos aportan, apuesten o no). Ghost tickets
  (`amount_bet=0, status=lost`) para los que no apostaron. Ganan los de **máximo aciertos** (`total_correct`);
  empate reparte parejo (`pool / #ganadores`). Sin house cut. Codificación L/E/V.
- **Pozo Polla Final** = `#jornadas × inscritos_aprobados × bet_final`. Puntaje **12/8/4/2** por posición **exacta**
  (repetidos solo suman en su posición). Ganan los de `maxPts>0`; empate reparte. Ofuscación de picks hasta el
  `final_bet_deadline` (comparación por instante UTC).

---

## 5. Frontend (Expo / React Native) — `react_native_space`

### 5.1 Stack
Expo SDK **54** (`~54.0.34`), RN **0.81.5**, React 19, Expo Router 6 (typed routes), react-native-web (SPA
`output:single`), NativeWind 4 + Tailwind 3, Zustand 5 (auth), React Query 5, axios, Reanimated 4
(**plugin `react-native-worklets/plugin` DEBE ser el último en babel** — si no, crash en APK release),
Sentry, jail-monkey (root/jailbreak), Ionicons, Poppins. yarn 4.13. **No hay `yarn test`.**

### 5.2 Ruteo (`app/`) y auth guard
- `app/_layout.tsx`: providers (ErrorBoundary → QueryClient → Theme → Sidebar → Toast → DeviceSecurityGate →
  **AuthGuard**). `import '../global.css'` es la **primera línea**. AuthGuard: sin token → `/auth/login`;
  user → `/user`; admin → `/admin`; segmentos admin-only (`admin`, `admin-usuario`, `tournament`) expulsan
  no-admins. Monta `usePushNotifications` + `useWebPush`.
- Grupos: **`auth/`** (login, register), **`user/`** (index, quinielas, polla [condicional], perfil; grupos oculto),
  **`admin/`** (index, torneos, participar, partidos, polla, usuarios, notificaciones, auditoria, perfil),
  **`quiniela/`** (`[id]` apostar, `ranking/[matchdayId]`, `bet-log/[matchdayId]`, `ticket/[id]`),
  **`tournament/`** (admin: `[id]`, `group/[id]`, `matchday/[id]`, `matchday/report/[id]`, `matchday/winners/[id]`),
  **`grupo/[id]`** (desactivado, Redirect), **`torneos-inscripcion/`**, **`admin-usuario/[id]`**.

### 5.3 Estado y datos
- **`store/authStore.ts`** (Zustand): `login/register/logout/restoreSession/refreshUser/updateUser/isAdmin`.
  `restoreSession` solo limpia sesión ante 401/403 (no ante corte de red). En login `requires_2fa` → pide TOTP.
- **`services/queryClient.ts`**: **`staleTime: 8000`** (⚠️ la doc vieja decía 0), `keepPreviousData`, refetch
  on mount/reconnect/focus. En native cablea AppState→focusManager.
- **`services/api.ts`** (axios, `timeout 15s`): interceptor request (Bearer desde `secureStore`); interceptor
  response que en cualquier POST/PATCH/PUT/DELETE OK dispara `queryClient.invalidateQueries()` tras 50ms
  (**no agregar invalidaciones manuales redundantes**); en 401 con sesión → `logout()` completo.
- **`constants/api.ts`**: `EXPO_PUBLIC_API_URL` gana; web dev → `window.location.hostname:3000`; **fallback móvil
  hardcodeado a prod `https://app.esppapel.com:9443`** (un OTA con env vacío no debe apuntar a localhost).
- **`services/secureStorage.ts`**: Keychain (iOS) / EncryptedSharedPreferences (Android) / localStorage (web).
  El JWT SIEMPRE va acá. Logout limpia `AsyncStorage.clear()` **y** `secureStore.remove('token')`.

### 5.4 Temas y estilos
NativeWind + Tailwind + CSS vars. `contexts/ThemeContext.tsx` (web = CSS vars en `documentElement`, native = `vars()`
de NativeWind). **7 paletas** (`constants/palettes.ts`): `mundial`, **`claro` (DEFAULT, tema claro)**, `oceano`,
`esmeralda`, `dorado`, `violeta`, `fuego`. Se eligen en Perfil; se persisten **por usuario** en storage local
(`user_palette_<id>`). Componentes UI base en `components/ui/` (Button CVA, Badge, Modal con footer fijo, Toast,
TeamFlag, etc.).

### 5.5 Features clave
- **Apuestas por jornada** (`quiniela/[id].tsx`): picks L/E/V, **lock por-partido** (reloj vivo cada 1s;
  cada partido se sella al llegar su `match_date`; podés editar los no iniciados). Monto fijo. Pozo potencial
  = inscritos × bet_per_matchday. Mensajes troll al elegir. Badge "Avanza:" si hay `advanced_team_id`.
- **Ranking** (`quiniela/ranking/[matchdayId]`): tab jornada + tab acumulado (matriz N×M con buscador, toggle
  aciertos↔dinero, "La Carrera del Torneo", "Mi historial" privado).
- **Bet-log** (`quiniela/bet-log/[matchdayId]`): matriz de aciertos con **revelado por-partido**; flip card de
  picks propios (si `flip_own_picks`).
- **Polla Final** (`user/polla`, `admin/polla`, `admin/participar`): podio 1º-4º de los 8 de cuartos, puntos
  12/8/4/2, repetidos permitidos, **editable hasta el deadline** (banner prominente), pozo gordo con shimmer,
  ofuscación de picks ajenos hasta el cierre. Admin: switch de visibilidad (`polla_final_enabled`), reporte, PDF,
  resolver.
- **Avance de fase** (`advanced_team_id`): en `admin/partidos.tsx`, al cargar el marcador de un partido de
  eliminación (ambos equipos en cuartos), selector "¿Quién avanzó?"; badge verde read-only en las vistas.
  Separa el resultado de 90' (apuesta) del avance real (alargue/penales).
- **Reportes PDF** (`services/downloadPdf.ts`): web blob-download, móvil share sheet. Server-side (pdfkit), sin @usernames.
- **Avatares** (`services/avatar.ts`): comprime en cliente (~256px, ≤500 KB), `POST /api/users/me/avatar`.
- **PWA/offline** (web): `public/sw.js` (network-first en API GETs, `/api/auth/me` nunca cacheado, Background Sync
  de apuestas, Web Push), `VERSION='mundial2026-__BUILD_ID__'` estampado con el SHA en CI.
- **Seguridad de dispositivo**: `DeviceSecurityGate` (FLAG_SECURE, detección root), `AdminRouteGuard` (guard de
  render), `ErrorBoundary` (muestra crashes en pantalla para debug de APK sin adb).

### 5.6 Deuda técnica frontend a registrar
1. `staleTime` real = **8000 ms** (no 0). 2. `utils/flags.ts::getFlagImageUrl` devuelve SIEMPRE la bandera de
Papúa Nueva Guinea (roto, mitigado por fallback de `TeamFlag`). 3. Reglas de password inconsistentes en la UI
(el backend ≥8 es la verdad). 4. Grupos desactivado (Redirect). 5. Sin `yarn test`.

---

## 6. Notificaciones + Firebase / FCM / Web Push

**Dos canales** (por `push_token.device_type`):

| Canal | Plataforma | Transporte | Credencial |
|---|---|---|---|
| **Expo Push** | Android/iOS (build nativo) | Backend `POST https://exp.host/--/api/v2/push/send` → Expo → FCM/APNs | FCM subido a EAS + `google-services.json` |
| **Web Push (VAPID)** | Navegadores (PWA) | Backend `web-push` directo al push service del browser. **NO usa Firebase** | Par VAPID (`VAPID_PUBLIC_KEY/PRIVATE_KEY`) |

El backend **NO usa `firebase-admin` ni `expo-server-sdk`** — solo la librería `web-push` + `fetch` a Expo.

**Cron real (activo):** `notifications/schedules.service.ts`, `@Cron(EVERY_MINUTE)` → lee `notification_schedule`
(tabla, editable por el admin en la app, **hot-reload**). Tipos `pre_match` (N min antes de cada partido, target
`non_bettors`/`tournament_participants`/`all`, dedupe con `match_reminder_log`) y `cron` (broadcast por expresión).
**No requiere `CRON_SECRET`.**

**Endpoints `/api/cron/*`** (matchday/final reminders): protegidos por `CronAuthGuard` (`X-Cron-Secret`). **No hay
disparador en el repo** → opcional/paralelo; configurar un scheduler externo si se quieren usar.

**Frontend:** `hooks/usePushNotifications.ts` (Expo token, no-op en Expo Go/web; deep-link al tocar la notif),
`hooks/useWebPush.ts` (pide VAPID pública a `/api/push/vapid-public-key` en runtime — **no está horneada**, por eso
rotar VAPID es solo backend), `public/sw.js` (handlers `push`/`notificationclick`). **No hay `firebase-messaging-sw.js`.**

**Config:** `app.json` (plugin `expo-notifications` defaultChannel, permisos `NOTIFICATIONS`/`POST_NOTIFICATIONS`,
`extra.eas.projectId`), `app.config.js` (inyecta `google-services.json` vía `GOOGLE_SERVICES_JSON`),
`google-services.json` (gitignored; proyecto `polla-esp`, Sender ID `355171610078`, package
`com.leizarm.mundial2026`), `plugins/withSSLPinning.js` (pinning).

**Runbook Firebase/FCM/VAPID desde cero:** ver §8.5.

---

## 7. Deploy, infra y CI/CD

### 7.1 Los DOS compose de prod (reconciliar)
`docker-compose.prod.yml` (**raíz**, el que copia el CI/CD): tiene `certbot` propio, monta cert de
`./docker/certbot/conf`, **no** sirve web, **no** pasa `CRON_SECRET`.
`nodejs_space/docker-compose.prod.yml` (**variante B**, más evolucionada): reusa `/etc/letsencrypt` del host,
**sirve el web** desde `./frontend-dist`, **sí** pasa `CRON_SECRET`. El servidor real es un híbrido cercano a B.
**Capturar el real antes de apagar:** `ssh deploy@app.esppapel.com 'cat /opt/mundial2026/docker-compose.prod.yml; echo ---; cat /opt/mundial2026/.env.prod'`.

### 7.2 Nginx (`docker/nginx/`)
Rate-limit zones (api 60/m, auth 10/m), anti-Slowloris, `real_ip` (X-Forwarded-For). `:80` ACME + 301; `:443`
TLS 1.2/1.3, HSTS, headers de seguridad, rate-limit por location, bloqueo de probes (`.env`, wp-admin, etc.),
`/health` sin rate-limit. **`server_name` y rutas de cert HARDCODEADOS a `app.esppapel.com`** (no usa `DOMAIN`).

### 7.3 CrowdSec
Diseño: lee logs de Nginx → banea en nftables via firewall-bouncer del host. **Realidad prod:** acquisition
redirigida a `/dev/stdout` → **sin detección local**, solo blocklist global CAPI (decisión deliberada).

### 7.4 TLS / Let's Encrypt
Caso A (recomendado): reusar cert del host (`/etc/letsencrypt:ro`). Caso B: emitir HTTP-01 (liberar puerto 80).
Caso C: DNS-01. **Caducan a 90 días → re-emitir siempre al reactivar.**

### 7.5 Backups (`docker/backup.sh`, servicio `db-backup`, diario)
`pg_dump | gzip -9 | gpg --symmetric --cipher-algo AES256 --passphrase $BACKUP_GPG_PASSPHRASE` →
`/backups/mundial2026-*.sql.gz.gpg`. Retención 14 días. **Sin la passphrase (en `.env.prod`, gitignored) los
backups son irrecuperables.** Restaurar: `gpg --decrypt ... | gunzip | psql`.

### 7.6 CI/CD
- **Backend** (`.github/workflows/deploy.yml`, push a `main` que toque `nodejs_space/**`): test (tsc) → build imagen
  `Dockerfile.prod` → push `ghcr.io/<owner>/mundial2026-backend:{latest,sha}` → SSH `deploy@host` →
  `scp` compose+docker → `docker compose pull backend && up -d` → `curl /health`.
- **Frontend web** (repo frontend `deploy.yml` + raíz `frontend-build-branch.yml`): `expo export --platform web`
  (con `EXPO_PUBLIC_API_URL` prod) → estampa `sw.js` con SHA → push a rama **`web-build`** → Plesk auto-pull
  (`apuestamundial.impexpap.com`). Alternativa `raíz/frontend.yml`: SFTP a Plesk. Alternativa `scripts/deploy-web.ps1`: scp a Nginx propio.
- **APK/AAB** (`apk.yml`, manual o tag `v*`): `eas build --platform android --profile {preview|production}` (requiere `EXPO_TOKEN`).
- **OTA** (`scripts/ota-update.ps1 -Message "..."`): fuerza `EXPO_PUBLIC_API_URL`/`SENTRY_DSN` en el shell (porque
  `eas update` ignora el env de `eas.json`) → `eas update --branch preview`. Solo JS/assets del mismo `runtimeVersion`.

### 7.7 EAS / app.json
`eas.json`: perfil **preview** (APK, `distribution:internal`, channel `preview`) y **production** (AAB,
`autoIncrement:true`, channel `production`). `app.json`: `version 1.0.0`, **`runtimeVersion.policy: appVersion`**
(subir `version` corta la compatibilidad OTA → build nativo nuevo), `updates.url = https://u.expo.dev/64a3d4b2-...`,
package/bundle `com.leizarm.mundial2026`.

### 7.8 SSL Pinning (`plugins/withSSLPinning.js`)
3 pines SHA-256 (leaf + intermedio Let's Encrypt + root ISRG Root X2). **`pin-set expiration="2027-01-01"`**:
después de esa fecha Android ignora el pinning. Antes de ella, un cert de otra CA rompe los APK viejos → rebuild
nativo con pines nuevos (el comando `openssl` para obtenerlos está en la cabecera del archivo).

---

## 8. Inventario COMPLETO de env vars y secretos

### 8.1 Backend dev (`nodejs_space/.env`)
`DATABASE_URL` (`postgresql://postgres:postgres@localhost:5432/mundial2026`), `JWT_SECRET` (en dev está en
`docker-compose.yml`: `6UFvDGJaKMlmj8znpJMqcROOmlW9zV3z`), `JWT_EXPIRES_IN` (opc), `CORS_ORIGINS` (opc),
`ENABLE_SWAGGER` (opc), `SEED_ADMIN_PASSWORD`/`SEED_USER_PASSWORD` (solo seed).

### 8.2 Backend prod (`/opt/mundial2026/.env.prod`, gitignored) — generar a mano
| Variable | Cómo obtenerla |
|---|---|
| `POSTGRES_USER` / `POSTGRES_DB` | ej. `mundial_admin` / `mundial2026` |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `JWT_SECRET` | `openssl rand -base64 48` (≥16 chars o el backend no arranca) |
| `JWT_EXPIRES_IN` | `7d` (informativo; el código usa 35d hardcodeado) |
| `CORS_ORIGINS` | dominio(s) del frontend, coma-separado, **sin `*`** (ej. `https://apuestamundial.impexpap.com`) |
| `PUBLIC_API_URL` / `DOMAIN` / `LETSENCRYPT_EMAIL` | informativos (`https://app.esppapel.com:9443` / `app.esppapel.com` / tu email) |
| `BACKUP_GPG_PASSPHRASE` | `openssl rand -base64 32` — **guardar en gestor de contraseñas** |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | `mailto:tu-email@example.com` |
| `CRON_SECRET` | `openssl rand -base64 24` — **falta en `.env.prod.example`**, agregar a mano |
| `BACKEND_IMAGE` | la setea el CI/CD (`ghcr.io/...:<sha>`) |

> Ojo: `.env.prod.example` trae el dominio viejo `mundial.esppapel.com`; el real es `app.esppapel.com:9443`.

### 8.3 Frontend build/OTA
`EXPO_PUBLIC_API_URL=https://app.esppapel.com:9443`, `EXPO_PUBLIC_SENTRY_DSN=<dsn>`,
`YARN_ENABLE_IMMUTABLE_INSTALLS=false`, `SENTRY_DISABLE_AUTO_UPLOAD/ALLOW_FAILURE=true`,
`GOOGLE_SERVICES_JSON` (EAS file secret), `SSL_PIN_{PRIMARY,BACKUP,ROOT}` (opc).

### 8.4 GitHub Secrets
- **polla-backend:** `SSH_HOST` (app.esppapel.com), `SSH_USER` (deploy), `SSH_PORT` (22), `SSH_PRIVATE_KEY`
  (ed25519), `GHCR_USER`, `GHCR_TOKEN` (PAT con write:packages). Opcionales para deploy web: `PLESK_*` / `VERCEL_*` / `EXPO_TOKEN`.
- **polla-frontend:** `EXPO_TOKEN` (expo.dev). `GITHUB_TOKEN` (auto) para push a `web-build`.

### 8.5 EAS / Expo (en expo.dev)
Owner `renmleizar`, `EXPO_TOKEN`, **EAS file secret `GOOGLE_SERVICES_JSON`**, **keystore Android** (gestionado por
EAS — respaldar con `eas credentials` o un AAB reactivado no podrá actualizar la app en Play Store).

**Runbook Firebase/FCM desde cero:** (1) crear proyecto Firebase, registrar app Android con package
`com.leizarm.mundial2026`; (2) descargar `google-services.json` → a la raíz del frontend + `eas secret:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json`;
(3) en Firebase → Cloud Messaging habilitar FCM V1 + generar cuenta de servicio JSON → subir a Expo con `eas credentials` (Android → FCM V1);
(4) iOS: subir APNs key (.p8) a `eas credentials`. **VAPID desde cero:** `npx web-push generate-vapid-keys` → poner el par en `.env.prod` (el frontend la pide en runtime, no rebuild).

### 8.6 Archivos NO en git (preservar/recrear)
`.env`, `.env.prod`, `*.pem`, `*.key`, `docker/certbot/*`, `backups/` + `*.sql.gz.gpg`, `google-services.json`,
`GoogleService-Info.plist`, `vapid-keys.json`, `node_modules/`, `dist/`, `.expo/`. **Y el volumen Docker `pgdata`** (los datos reales).

---

## 9. Reglas de negocio (resumen)
- **Sin wallet, sin balance desde la app.** Pagos offline. Moneda `Bs`.
- **Apuesta por jornada:** monto fijo `bet_per_matchday`; picks L/E/V; **lock por-partido** (cada match se sella a su
  `match_date`); requiere `tournament_participant.status='approved'`.
- **Pozo jornada** = `bet_per_matchday × inscritos_aprobados`; ganan los de más aciertos; empate reparte parejo.
  **Ghost tickets** (`amount_bet=0`) para no-apostadores (aportan al pozo, no ganan).
- **Polla Final:** predice 1º-4º de los 8 de cuartos (`advanced_to_quarters`); puntos 12/8/4/2 por posición exacta;
  **repetidos permitidos**; editable hasta `final_bet_deadline`; picks ofuscados hasta el cierre. Pozo =
  `jornadas × inscritos_aprobados × bet_final`.
- **Avance de fase** (`advanced_team_id`): separado del resultado de 90'; solo equipos en cuartos.
- **Inscripto tardío:** hereda las jornadas pasadas en el pozo (ghost ticket + prorrateo) pero no las ve.

---

## 10. Checklist — BAJAR de producción
```bash
cd /opt/mundial2026
# 1. Capturar el compose y env REALES (pueden diferir del repo)
cat docker-compose.prod.yml > /tmp/compose-real.yml ; cat .env.prod > /tmp/env-real
# 2. Backup fresco
docker compose -f docker-compose.prod.yml --env-file .env.prod exec db-backup /backup.sh
# 3. Volcar el volumen de datos a un tar
docker run --rm -v mundial2026_pgdata:/data -v "$PWD":/out alpine tar czf /out/pgdata-$(date +%F).tar.gz -C /data .
# 4. COPIAR FUERA DEL SERVIDOR: backups/, .env.prod (tiene BACKUP_GPG_PASSPHRASE), pgdata-*.tar.gz, compose real
# 5. Apagar (PRESERVA volúmenes → datos intactos):
docker compose -f docker-compose.prod.yml --env-file .env.prod down
sudo systemctl disable --now crowdsec-firewall-bouncer
# ⚠️ NO usar `down -v` salvo backup externo confirmado (borra pgdata y todo).
```
**Guardar en un gestor de contraseñas / bóveda:** `BACKUP_GPG_PASSPHRASE`, `JWT_SECRET`, `POSTGRES_PASSWORD`,
`VAPID_*`, `EXPO_TOKEN`, keystore Android (EAS), y este handbook.

## 11. Checklist — REACTIVAR en el futuro
```bash
cd /opt/mundial2026 && git pull
# 1. Restaurar .env.prod (de la bóveda) ; chmod 600 .env.prod
# 2. Re-emitir el cert TLS (el viejo caducó a 90 días) — Caso A/B/C
# 3a. Si el volumen pgdata sobrevivió → arrancar directo:
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# 3b. Si el host se decomisionó → recrear desde backup:
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d db   # esperar healthy
gpg --decrypt --batch --passphrase "$BACKUP_GPG_PASSPHRASE" backups/mundial2026-*.sql.gz.gpg | gunzip \
  | docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# 4. Reactivar bouncer CrowdSec ; verificar:
curl -k https://app.esppapel.com:9443/health
# 5. Frontend: rebuild web (rama web-build/Plesk) + APK/AAB con EAS.
#    Si reactivás ANTES de 2027-01-01 con cert de otra CA → REBUILD nativo con pines SSL nuevos (no basta OTA).
# 6. Configurar torneo nuevo: crear tournament, teams, inscribir/aprobar participantes, jornadas, matches.
```
**Nota móvil:** si cambia el dominio del backend, editar `constants/api.ts` (fallback hardcodeado) y `withSSLPinning.js`
(pines) y rebuildear. Un OTA solo cambia JS del mismo `runtimeVersion`.

## 12. Dev local (para verificar el código años después)
```bash
./start-docker.sh   # db :5432, backend :3000 (prisma db push + start:dev), web :8081
# o host node + Postgres local:
./start-local.sh
```
Backend: `cd nodejs_space && yarn install && yarn start:dev` (necesita `.env` con `DATABASE_URL`).
Frontend: `cd react_native_space && yarn install && yarn start` (necesita backend vivo; sin él solo carga login).

---

## Anexo — mapa de archivos clave
**Backend:** `src/main.ts`, `src/app.module.ts`, `src/auth/**` (guards/strategy/2FA/geofence), `src/matches/matches.service.ts`
(L/E/V + avance), `src/matchdays/matchdays.service.ts` (resolve + ghost tickets), `src/final-bets/final-bets.service.ts`
(Polla Final + ofuscación), `src/notifications/{notifications,schedules}.service.ts`, `prisma/schema.prisma`,
`prisma/functions.sql` (muerto), `scripts/{safe-seed,seed}.ts`, `.env.prod.example`, `Dockerfile.prod`.
**Frontend:** `app/_layout.tsx`, `store/authStore.ts`, `services/{api,queryClient,secureStorage,downloadPdf,avatar}.ts`,
`constants/{api,theme,palettes}.ts`, `contexts/ThemeContext.tsx`, `hooks/{usePushNotifications,useWebPush,useAppSettings}.ts`,
`app/quiniela/[id].tsx`, `app/user/polla.tsx`, `app/admin/{polla,participar,partidos,notificaciones}.tsx`,
`public/sw.js`, `plugins/withSSLPinning.js`, `eas.json`, `app.json`, `app.config.js`, `scripts/ota-update.ps1`.
**Infra:** `docker-compose*.yml`, `docker/{nginx,crowdsec,certbot,backup.sh,init.sql}`, `deploy/*`,
`.github/workflows/*`, `DEPLOY.md`.

*Generado como manual de reactivación. La verdad está en el código; este doc es el mapa.*
