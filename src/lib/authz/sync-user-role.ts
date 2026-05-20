import type { Prisma } from "@prisma/client";

import { invalidateAuthzForUser } from "@/lib/authz";

/**
 * Sincroniza UserRoleAssignment do usuario com o preset legado
 * (`User.role` = ADMIN/MANAGER/MEMBER).
 *
 * Bug de origem (2026-05-20): rotas `POST /api/users` e `PUT /api/users/[id]`
 * criavam/atualizavam o campo `User.role` mas nao tocavam em
 * `UserRoleAssignment`. Como `loadAuthzContext` busca permissions
 * apenas em `user_role_assignments`, qualquer user criado via UI ficava
 * com `permissions = []` e era barrado por toda rota que usa `can()`.
 *
 * Estrategia:
 *   1. Encontra a Role da org com `systemPreset = <role>` (preset
 *      criado no seed/Phase1 — sempre existe).
 *   2. Remove outras assignments de preset desta org (mantem custom
 *      roles intactas — so derruba os 3 presets antigos).
 *   3. Upsert assignment do preset alvo.
 *   4. Invalida cache de authz do user.
 *
 * Operacao idempotente: rodar 2x da o mesmo resultado.
 *
 * Caso a Role preset nao exista (org legada antes da Fase 1), retornamos
 * `false` e o caller pode logar/decidir. Isso NAO deve acontecer em orgs
 * novas porque a Phase1 migration cria as 3 presets pra cada org.
 */
export async function syncUserRoleAssignment(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    organizationId: string;
    role: "ADMIN" | "MANAGER" | "MEMBER";
    assignedById?: string | null;
  },
): Promise<boolean> {
  const presetRole = await tx.role.findFirst({
    where: {
      organizationId: args.organizationId,
      systemPreset: args.role,
    },
    select: { id: true },
  });

  if (!presetRole) {
    return false;
  }

  const otherPresetRoleIds = (
    await tx.role.findMany({
      where: {
        organizationId: args.organizationId,
        systemPreset: { in: ["ADMIN", "MANAGER", "MEMBER"], not: args.role },
      },
      select: { id: true },
    })
  ).map((r) => r.id);

  if (otherPresetRoleIds.length > 0) {
    await tx.userRoleAssignment.deleteMany({
      where: {
        userId: args.userId,
        organizationId: args.organizationId,
        roleId: { in: otherPresetRoleIds },
      },
    });
  }

  await tx.userRoleAssignment.upsert({
    where: {
      userId_roleId: {
        userId: args.userId,
        roleId: presetRole.id,
      },
    },
    create: {
      userId: args.userId,
      roleId: presetRole.id,
      organizationId: args.organizationId,
      assignedById: args.assignedById ?? null,
    },
    update: {},
  });

  await invalidateAuthzForUser(args.userId);
  return true;
}
