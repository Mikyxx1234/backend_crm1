-- Piloto "matriculados": dados acadêmicos de alunos + histórico de importações.
-- Idempotente (IF NOT EXISTS) para permitir aplicação manual segura em ambientes
-- onde SKIP_PRISMA_MIGRATE=1 (deploy não roda migração automática).

CREATE TABLE IF NOT EXISTS "student_academic_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cpf" TEXT,
    "rgm" TEXT,
    "nome" TEXT NOT NULL,
    "curso" TEXT,
    "serie" TEXT,
    "polo" TEXT,
    "ciclo" TEXT,
    "instituicao" TEXT,
    "situacao" TEXT,
    "tipo_matricula" TEXT,
    "data_matricula" TIMESTAMP(3),
    "data_nascimento" TEXT,
    "email" TEXT,
    "email_academico" TEXT,
    "phone" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_academic_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "student_academic_records_organization_id_cpf_idx" ON "student_academic_records"("organization_id", "cpf");
CREATE INDEX IF NOT EXISTS "student_academic_records_organization_id_phone_idx" ON "student_academic_records"("organization_id", "phone");
CREATE INDEX IF NOT EXISTS "student_academic_records_organization_id_email_idx" ON "student_academic_records"("organization_id", "email");

CREATE TABLE IF NOT EXISTS "academic_import_history" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "report_type" TEXT NOT NULL DEFAULT 'matriculados',
    "file_name" TEXT,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by_id" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_import_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "academic_import_history_organization_id_imported_at_idx" ON "academic_import_history"("organization_id", "imported_at");
