-- UserDashboardLayout
-- Persiste layouts de widgets do dashboard customizável (estilo Kommo)
-- por usuário. Um usuário pode ter múltiplos layouts nomeados e marcar
-- um como default. O JSON em `data` guarda a grade 2D (x/y/w/h por
-- widget), filtros e tema.
--
-- Idempotente: IF NOT EXISTS para permitir retry de `prisma migrate deploy`.

CREATE TABLE IF NOT EXISTS "user_dashboard_layouts" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "name"      TEXT NOT NULL DEFAULT 'Padrão',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "preset"    TEXT NOT NULL DEFAULT 'custom',
    "data"      JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_dashboard_layouts_pkey" PRIMARY KEY ("id")
);

-- Índices
CREATE UNIQUE INDEX IF NOT EXISTS "user_dashboard_layouts_userId_name_key"
    ON "user_dashboard_layouts"("userId", "name");

CREATE INDEX IF NOT EXISTS "user_dashboard_layouts_userId_isDefault_idx"
    ON "user_dashboard_layouts"("userId", "isDefault");

-- FK
DO $$ BEGIN
    ALTER TABLE "user_dashboard_layouts"
      ADD CONSTRAINT "user_dashboard_layouts_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
