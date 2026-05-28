-- ─── user.last_seen_at ─────────────────────────────────────────────────
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMPTZ(6);

-- ─── notification_schedule ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_schedule" (
  "id"             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "name"           VARCHAR(100) NOT NULL,
  "enabled"        BOOLEAN NOT NULL DEFAULT TRUE,
  "kind"           VARCHAR(20) NOT NULL,
  "offset_minutes" INTEGER,
  "cron_expr"      VARCHAR(50),
  "title"          VARCHAR(80) NOT NULL,
  "body"           TEXT NOT NULL,
  "target"         VARCHAR(30) NOT NULL DEFAULT 'non_bettors',
  "last_run_at"    TIMESTAMPTZ(6),
  "last_sent_count" INTEGER DEFAULT 0,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_notif_schedule_enabled_kind"
  ON "notification_schedule" ("enabled", "kind");

-- ─── match_reminder_log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "match_reminder_log" (
  "match_id"     UUID NOT NULL,
  "schedule_id"  UUID NOT NULL REFERENCES "notification_schedule"("id") ON DELETE CASCADE,
  "sent_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "sent_count"   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("match_id", "schedule_id")
);

CREATE INDEX IF NOT EXISTS "idx_match_reminder_sent"
  ON "match_reminder_log" ("sent_at");
