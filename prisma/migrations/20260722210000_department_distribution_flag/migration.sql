-- Distribuição Inteligente por departamento passa a ser POR DEPARTAMENTO
-- (flag em `departments`) em vez de um toggle global da org. Remove o toggle
-- global e adiciona a flag por departamento.
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "distributeByDepartment";
ALTER TABLE "departments" ADD COLUMN "distributionEnabled" BOOLEAN NOT NULL DEFAULT false;
