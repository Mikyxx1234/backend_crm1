-- Associacao N:N usuario <-> departamento (composicao do time).
-- Vinculo puramente organizacional; nao concede acesso ao inbox.

CREATE TABLE "department_members" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "departmentId"   TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "department_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "department_members_departmentId_userId_key"
  ON "department_members"("departmentId", "userId");
CREATE INDEX "department_members_organizationId_idx"
  ON "department_members"("organizationId");
CREATE INDEX "department_members_userId_idx"
  ON "department_members"("userId");
CREATE INDEX "department_members_departmentId_idx"
  ON "department_members"("departmentId");

ALTER TABLE "department_members"
  ADD CONSTRAINT "department_members_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "department_members"
  ADD CONSTRAINT "department_members_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "department_members"
  ADD CONSTRAINT "department_members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
