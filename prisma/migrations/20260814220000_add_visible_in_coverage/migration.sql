-- Grade de cobertura: ocultar pessoas (ex. admins) sem tirá-las da org.
ALTER TABLE "distribution_responsibles"
  ADD COLUMN IF NOT EXISTS "visibleInCoverage" BOOLEAN NOT NULL DEFAULT true;
