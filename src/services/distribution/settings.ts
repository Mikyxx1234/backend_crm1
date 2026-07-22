/**
 * Configuração de nível-organização da Distribuição Inteligente.
 *
 * Hoje: `distributeByDepartment` — toggle global. Quando ligado, o motor
 * (`engine.ts`) restringe os responsáveis aos membros do departamento do
 * lead (derivado da conversa), ainda respeitando a regra individual de cada
 * um. Persistido em `Organization` (não tenant-scoped: a org É o tenant),
 * por isso usamos `prismaBase` + filtro explícito por id.
 */

import { prismaBase } from "@/lib/prisma-base";
import { getOrgIdOrThrow } from "@/lib/request-context";

export interface DistributionSettings {
  distributeByDepartment: boolean;
}

export async function getDistributionSettings(): Promise<DistributionSettings> {
  const orgId = getOrgIdOrThrow();
  const org = await prismaBase.organization.findUnique({
    where: { id: orgId },
    select: { distributeByDepartment: true },
  });
  return { distributeByDepartment: org?.distributeByDepartment ?? false };
}

export async function setDistributionSettings(
  input: Partial<DistributionSettings>,
): Promise<DistributionSettings> {
  const orgId = getOrgIdOrThrow();
  const org = await prismaBase.organization.update({
    where: { id: orgId },
    data: {
      ...(input.distributeByDepartment !== undefined
        ? { distributeByDepartment: input.distributeByDepartment }
        : {}),
    },
    select: { distributeByDepartment: true },
  });
  return { distributeByDepartment: org.distributeByDepartment };
}
