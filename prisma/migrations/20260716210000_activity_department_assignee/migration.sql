-- Tarefa (Activity) pode ser atribuída a um DEPARTAMENTO (compartilhada)
-- além de/ou em vez de um usuário. userId passa a ser opcional.

ALTER TABLE "activities" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "activities" ADD COLUMN "departmentId" TEXT;

CREATE INDEX "activities_organizationId_departmentId_idx"
  ON "activities"("organizationId", "departmentId");

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
