-- ─── user avatar (foto de perfil) ──────────────────────────────────────
-- Imagen BINARIA (comprimida en el cliente ~256px) + su mime + timestamp.
-- avatar_updated_at sirve como flag "tiene foto" (sin cargar los bytes en las
-- listas) y para cache-bustear la URL /api/users/:id/avatar.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "avatar" BYTEA;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "avatar_mime" VARCHAR(30);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "avatar_updated_at" TIMESTAMPTZ(6);
