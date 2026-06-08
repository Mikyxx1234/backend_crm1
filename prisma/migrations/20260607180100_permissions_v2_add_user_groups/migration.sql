-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions v2 (Sprint 1) — UserGroup + UserGroupMember + Role.scopeConfig
--
-- Schema-only. Não toca em dados existentes. Idempotente via IF NOT EXISTS
-- e blocos DO/EXCEPTION para constraints (Postgres não suporta IF NOT EXISTS
-- em FKs/uniques diretamente).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Role.scopeConfig (campo novo, opcional) ──
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "scope_config" JSONB;

-- ── 2. Tabela user_groups ──
CREATE TABLE IF NOT EXISTS "user_groups" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "role_id" TEXT,
    "channel_grants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stage_grants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_groups_organization_id_idx" ON "user_groups"("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "user_groups_organization_id_name_key" ON "user_groups"("organization_id", "name");

DO $$ BEGIN
    ALTER TABLE "user_groups"
      ADD CONSTRAINT "user_groups_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "user_groups"
      ADD CONSTRAINT "user_groups_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "roles"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Tabela user_group_members ──
CREATE TABLE IF NOT EXISTS "user_group_members" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_group_members_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_group_members_group_id_idx" ON "user_group_members"("group_id");
CREATE INDEX IF NOT EXISTS "user_group_members_user_id_idx" ON "user_group_members"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "user_group_members_group_id_user_id_key" ON "user_group_members"("group_id", "user_id");

DO $$ BEGIN
    ALTER TABLE "user_group_members"
      ADD CONSTRAINT "user_group_members_group_id_fkey"
      FOREIGN KEY ("group_id") REFERENCES "user_groups"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "user_group_members"
      ADD CONSTRAINT "user_group_members_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "user_group_members"
      ADD CONSTRAINT "user_group_members_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "roles"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
