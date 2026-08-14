-- Janela operacional por departamento (grade de cobertura).
-- Null = default implícito Seg–Sex 09:00–18:00 no app.
ALTER TABLE "departments"
  ADD COLUMN IF NOT EXISTS "operatingHours" JSONB;
