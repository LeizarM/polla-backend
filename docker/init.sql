-- Mundial 2026 — init script (corre solo al crear el volumen postgres por primera vez)
-- Crea extensiones necesarias. El schema lo gestiona Prisma `db push`.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
