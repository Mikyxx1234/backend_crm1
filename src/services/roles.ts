import type { Prisma } from "@prisma/client";

import { invalidateAuthzForOrg } from "@/lib/authz";
import { sanitizePermissions } from "@/lib/authz/permissions";
import {
  ensureSystemPresetRoles,
  syncMissingUserRoleAssignments,
} from "@/lib/authz/sync-user-role";
import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";

const roleListSelect = {
  id: true,
  name: true,
  description: true,
  systemPreset: true,
  isSystem: true,
  permissions: true,
  inheritsFrom: true,
  _count: { select: { assignments: true } },
} satisfies Prisma.RoleSelect;

const roleDetailSelect = {
  ...roleListSelect,
  assignments: {
    select: {
      id: true,
      user: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.RoleSelect;

function mapRoleList(
  row: Prisma.RoleGetPayload<{ select: typeof roleListSelect }>,
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPreset: row.systemPreset,
    isSystem: row.isSystem,
    permissions: row.permissions,
    inheritsFrom: row.inheritsFrom,
    _count: {
      assignments: row._count.assignments,
      groups: 0,
      groupMembers: 0,
    },
  };
}

function mapRoleDetail(
  row: Prisma.RoleGetPayload<{ select: typeof roleDetailSelect }>,
) {
  return {
    ...mapRoleList(row),
    assignments: row.assignments.map((a) => ({
      id: a.id,
      user: a.user,
    })),
  };
}

/** Lista roles da org. Auto-cura presets ausentes (orgs criadas pós-migration). */
export async function listRoles() {
  const orgId = getOrgIdOrThrow();
  await prisma.$transaction(async (tx) => {
    await ensureSystemPresetRoles(tx, orgId);
    await syncMissingUserRoleAssignments(tx, orgId);
  });

  const rows = await prisma.role.findMany({
    where: { organizationId: orgId },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    select: roleListSelect,
  });
  return rows.map(mapRoleList);
}

export async function getRoleById(id: string) {
  const orgId = getOrgIdOrThrow();
  const row = await prisma.role.findFirst({
    where: { id, organizationId: orgId },
    select: roleDetailSelect,
  });
  return row ? mapRoleDetail(row) : null;
}

/**
 * Valida o ponteiro de heranca: precisa ser um Role existente na MESMA org
 * (ou null). Evita apontar pra role de outro tenant ou pra id inexistente.
 * `selfId` impede um grupo de herdar de si mesmo (no update).
 */
async function resolveInheritsFrom(
  orgId: string,
  value: string | null | undefined,
  selfId?: string,
): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const baseId = value.trim();
  if (!baseId) return null;
  if (selfId && baseId === selfId) {
    throw new Error("Um grupo não pode herdar de si mesmo.");
  }
  const base = await prisma.role.findFirst({
    where: { id: baseId, organizationId: orgId },
    select: { id: true },
  });
  if (!base) throw new Error("Grupo de origem (herança) não encontrado.");
  return base.id;
}

export async function createRole(input: {
  name: string;
  description?: string | null;
  permissions: string[];
  inheritsFrom?: string | null;
}) {
  const orgId = getOrgIdOrThrow();
  const name = input.name.trim();
  if (!name) throw new Error("Nome é obrigatório.");

  const permissions = sanitizePermissions(input.permissions);
  const inheritsFrom = await resolveInheritsFrom(orgId, input.inheritsFrom);
  const role = await prisma.role.create({
    data: {
      organizationId: orgId,
      name,
      description: input.description?.trim() || null,
      permissions,
      inheritsFrom: inheritsFrom ?? null,
      isSystem: false,
      systemPreset: null,
    },
    select: roleDetailSelect,
  });
  return mapRoleDetail(role);
}

export async function updateRole(
  id: string,
  input: {
    name?: string;
    description?: string | null;
    permissions?: string[];
    inheritsFrom?: string | null;
  },
) {
  const orgId = getOrgIdOrThrow();
  const existing = await prisma.role.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, isSystem: true, systemPreset: true, permissions: true },
  });
  if (!existing) return null;

  const data: Prisma.RoleUpdateInput = {};

  if (!existing.isSystem) {
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("Nome é obrigatório.");
      data.name = name;
    }
    if (input.description !== undefined) {
      data.description = input.description?.trim() || null;
    }
    // Troca de origem de heranca so faz sentido em grupos custom.
    if (input.inheritsFrom !== undefined) {
      data.inheritsFrom = await resolveInheritsFrom(
        orgId,
        input.inheritsFrom,
        id,
      );
    }
  }

  if (input.permissions !== undefined) {
    let permissions = sanitizePermissions(input.permissions);
    // Preset ADMIN sempre mantém wildcard — kill switch do authz.
    if (existing.systemPreset === "ADMIN") {
      permissions = ["*"];
    } else if (permissions.length === 0) {
      throw new Error("O role precisa ter ao menos uma permissão.");
    }
    data.permissions = permissions;
  }

  const role = await prisma.role.update({
    where: { id },
    data,
    select: roleDetailSelect,
  });

  await invalidateAuthzForOrg(orgId);
  return mapRoleDetail(role);
}

export async function deleteRole(id: string) {
  const orgId = getOrgIdOrThrow();
  const existing = await prisma.role.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, isSystem: true, _count: { select: { assignments: true } } },
  });
  if (!existing) return null;
  if (existing.isSystem) {
    throw new Error("Roles de sistema não podem ser excluídos.");
  }
  if (existing._count.assignments > 0) {
    const n = existing._count.assignments;
    throw new Error(
      `Este grupo tem ${n} ${n === 1 ? "membro" : "membros"}. ` +
        "Mova-os para outro grupo antes de excluir.",
    );
  }

  await prisma.role.delete({ where: { id } });
  await invalidateAuthzForOrg(orgId);
  return { ok: true as const };
}

export async function addRoleAssignment(roleId: string, userId: string) {
  const orgId = getOrgIdOrThrow();
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: orgId },
    select: { id: true },
  });
  if (!role) return null;

  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: orgId, type: "HUMAN", isErased: false },
    select: { id: true },
  });
  if (!user) throw new Error("Usuário não encontrado nesta organização.");

  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId, roleId } },
    create: { userId, roleId, organizationId: orgId },
    update: {},
  });

  await invalidateAuthzForOrg(orgId);
  return getRoleById(roleId);
}

export async function removeRoleAssignment(roleId: string, userId: string) {
  const orgId = getOrgIdOrThrow();
  const deleted = await prisma.userRoleAssignment.deleteMany({
    where: { roleId, userId, organizationId: orgId },
  });
  if (deleted.count === 0) return null;
  await invalidateAuthzForOrg(orgId);
  return { ok: true as const };
}
