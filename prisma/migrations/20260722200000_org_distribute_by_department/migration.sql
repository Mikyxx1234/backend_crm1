-- Distribuição Inteligente por departamento (toggle global da org).
ALTER TABLE "organizations" ADD COLUMN "distributeByDepartment" BOOLEAN NOT NULL DEFAULT false;
