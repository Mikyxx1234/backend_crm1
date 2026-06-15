import type { Prisma } from "@prisma/client";
import { PermissionLevel } from "@prisma/client";

import { invalidateAuthzForOrg } from "@/lib/authz";
import { isValidPermissionKey } from "@/lib/authz/permissions";
import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";

// ─── Tipos de entrada (contrato com as rotas) ────────────────────────────────

export type ScopedPermissionInput = {
  resource: string;
  action: string;
  level: PermissionLevel | string;
};

export type StageGrantInput = {
  stageId: string;
  canView?: boolean;
  canEdit?: boolean;
};

export type FieldGrantInput = {
  entity: string;
  fieldKey: string;
  canView?: boolean;
  canEdit?: boolean;
};

export type GroupWriteInput = {
  name?: string;
  description?: string | null;
  sharedInbox?: boolean;
  mediaAccess?: boolean;
  sidebarRoutes?: string[];
  permissions?: ScopedPermissionInput[];
  stageGrants?: StageGrantInput[];
  fieldGrants?: FieldGrantInput[];
};

// ─── Selects + mapeadores ────────────────────────────────────────────────────

const groupListSelect = {
  id: true,
  name: true,
  description: true,
  sharedInbox: true,
  mediaAccess: true,
  sidebarRoutes: true,
  _count: { select: { members: true, permissions: true } },
} satisfies Prisma.GroupSelect;

const groupDetailSelect = {
  ...groupListSelect,
  members: {
    select: {
      id: true,
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
  permissions: {
    select: { resource: true, action: true, level: true },
  },
  stageGrants: {
    select: { stageId: true, canView: true, canEdit: true },
  },
  fieldGrants: {
    select: { entity: true, fieldKey: true, canView: true, canEdit: true },
  },
} satisfies Prisma.GroupSelect;

function mapGroupList(
  row: Prisma.GroupGetPayload<{ select: typeof groupListSelect }>,
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sharedInbox: row.sharedInbox,
    mediaAccess: row.mediaAccess,
    sidebarRoutes: row.sidebarRoutes,
    _count: {
      members: row._count.members,
      permissions: row._count.permissions,
    },
  };
}

function mapGroupDetail(
  row: Prisma.GroupGetPayload<{ select: typeof groupDetailSelect }>,
) {
  return {
    ...mapGroupList(row),
    members: row.members.map((m) => ({ id: m.id, user: m.user })),
    permissions: row.permissions.map((p) => ({
      resource: p.resource,
      action: p.action,
      level: p.level,
    })),
    stageGrants: row.stageGrants.map((s) => ({
      stageId: s.stageId,
      canView: s.canView,
      canEdit: s.canEdit,
    })),
    fieldGrants: row.fieldGrants.map((f) => ({
      entity: f.entity,
      fieldKey: f.fieldKey,
      canView: f.canView,
      canEdit: f.canEdit,
    })),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_LEVELS = new Set<string>(Object.values(PermissionLevel));

/**
 * Normaliza/valida as permissões scoped: descarta `resource:action` fora do
 * catálogo, níveis inválidos e linhas NONE (ausência = NONE). Deduplica por
 * `resource:action` mantendo a última ocorrência.
 */
function sanitizeScopedPermissions(
  input: ScopedPermissionInput[] | undefined,
): { resource: string; action: string; level: PermissionLevel }[] {
  if (!input) return [];
  const byKey = new Map<
    string,
    { resource: string; action: string; level: PermissionLevel }
  >();
  for (const p of input) {
    const resource = String(p.resource ?? "").trim();
    const action = String(p.action ?? "").trim();
    const level = String(p.level ?? "NONE").toUpperCase();
    if (!resource || !action) continue;
    if (!isValidPermissionKey(`${resource}:${action}`)) continue;
    if (!VALID_LEVELS.has(level)) continue;
    if (level === "NONE") {
      byKey.delete(`${resource}:${action}`);
      continue;
    }
    byKey.set(`${resource}:${action}`, {
      resource,
      action,
      level: level as PermissionLevel,
    });
  }
  return [...byKey.values()];
}

function sanitizeStageGrants(input: StageGrantInput[] | undefined) {
  if (!input) return [];
  const byStage = new Map<
    string,
    { stageId: string; canView: boolean; canEdit: boolean }
  >();
  for (const s of input) {
    const stageId = String(s.stageId ?? "").trim();
    if (!stageId) continue;
    const canView = s.canView ?? true;
    const canEdit = s.canEdit ?? false;
    if (!canView && !canEdit) {
      byStage.delete(stageId);
      continue;
    }
    byStage.set(stageId, { stageId, canView, canEdit });
  }
  return [...byStage.values()];
}

function sanitizeFieldGrants(input: FieldGrantInput[] | undefined) {
  if (!input) return [];
  const byKey = new Map<
    string,
    { entity: string; fieldKey: string; canView: boolean; canEdit: boolean }
  >();
  for (const f of input) {
    const entity = String(f.entity ?? "").trim();
    const fieldKey = String(f.fieldKey ?? "").trim();
    if (!entity || !fieldKey) continue;
    byKey.set(`${entity}.${fieldKey}`, {
      entity,
      fieldKey,
      canView: f.canView ?? true,
      canEdit: f.canEdit ?? true,
    });
  }
  return [...byKey.values()];
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function listGroups() {
  const orgId = getOrgIdOrThrow();
  const rows = await prisma.group.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
    select: groupListSelect,
  });
  return rows.map(mapGroupList);
}

export async function getGroupById(id: string) {
  const orgId = getOrgIdOrThrow();
  const row = await prisma.group.findFirst({
    where: { id, organizationId: orgId },
    select: groupDetailSelect,
  });
  return row ? mapGroupDetail(row) : null;
}

export async function createGroup(input: GroupWriteInput) {
  const orgId = getOrgIdOrThrow();
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("Nome do grupo é obrigatório.");

  const permissions = sanitizeScopedPermissions(input.permissions);
  const stageGrants = sanitizeStageGrants(input.stageGrants);
  const fieldGrants = sanitizeFieldGrants(input.fieldGrants);

  const group = await prisma.group.create({
    data: {
      organizationId: orgId,
      name,
      description: input.description?.trim() || null,
      sharedInbox: input.sharedInbox ?? true,
      mediaAccess: input.mediaAccess ?? true,
      sidebarRoutes: input.sidebarRoutes ?? [],
      permissions: {
        create: permissions.map((p) => ({ ...p, organizationId: orgId })),
      },
      stageGrants: {
        create: stageGrants.map((s) => ({ ...s, organizationId: orgId })),
      },
      fieldGrants: {
        create: fieldGrants.map((f) => ({ ...f, organizationId: orgId })),
      },
    },
    select: groupDetailSelect,
  });

  await invalidateAuthzForOrg(orgId);
  return mapGroupDetail(group);
}

export async function updateGroup(id: string, input: GroupWriteInput) {
  const orgId = getOrgIdOrThrow();
  const existing = await prisma.group.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return null;

  const data: Prisma.GroupUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Nome do grupo é obrigatório.");
    data.name = name;
  }
  if (input.description !== undefined) {
    data.description = input.description?.trim() || null;
  }
  if (input.sharedInbox !== undefined) data.sharedInbox = input.sharedInbox;
  if (input.mediaAccess !== undefined) data.mediaAccess = input.mediaAccess;
  if (input.sidebarRoutes !== undefined) data.sidebarRoutes = input.sidebarRoutes;

  await prisma.$transaction(async (tx) => {
    await tx.group.update({ where: { id }, data });

    if (input.permissions !== undefined) {
      const permissions = sanitizeScopedPermissions(input.permissions);
      await tx.groupPermission.deleteMany({ where: { groupId: id } });
      if (permissions.length) {
        await tx.groupPermission.createMany({
          data: permissions.map((p) => ({ ...p, groupId: id, organizationId: orgId })),
        });
      }
    }
    if (input.stageGrants !== undefined) {
      const stageGrants = sanitizeStageGrants(input.stageGrants);
      await tx.groupStageGrant.deleteMany({ where: { groupId: id } });
      if (stageGrants.length) {
        await tx.groupStageGrant.createMany({
          data: stageGrants.map((s) => ({ ...s, groupId: id, organizationId: orgId })),
        });
      }
    }
    if (input.fieldGrants !== undefined) {
      const fieldGrants = sanitizeFieldGrants(input.fieldGrants);
      await tx.groupFieldGrant.deleteMany({ where: { groupId: id } });
      if (fieldGrants.length) {
        await tx.groupFieldGrant.createMany({
          data: fieldGrants.map((f) => ({ ...f, groupId: id, organizationId: orgId })),
        });
      }
    }
  });

  await invalidateAuthzForOrg(orgId);
  return getGroupById(id);
}

export async function deleteGroup(id: string) {
  const orgId = getOrgIdOrThrow();
  const existing = await prisma.group.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return null;
  await prisma.group.delete({ where: { id } });
  await invalidateAuthzForOrg(orgId);
  return { ok: true as const };
}

// ─── Membros ─────────────────────────────────────────────────────────────────

export async function addGroupMember(groupId: string, userId: string) {
  const orgId = getOrgIdOrThrow();
  const group = await prisma.group.findFirst({
    where: { id: groupId, organizationId: orgId },
    select: { id: true },
  });
  if (!group) return null;

  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: orgId, type: "HUMAN", isErased: false },
    select: { id: true },
  });
  if (!user) throw new Error("Usuário não encontrado nesta organização.");

  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId, userId } },
    create: { groupId, userId, organizationId: orgId },
    update: {},
  });

  await invalidateAuthzForOrg(orgId);
  return getGroupById(groupId);
}

export async function removeGroupMember(groupId: string, userId: string) {
  const orgId = getOrgIdOrThrow();
  const deleted = await prisma.groupMember.deleteMany({
    where: { groupId, userId, organizationId: orgId },
  });
  if (deleted.count === 0) return null;
  await invalidateAuthzForOrg(orgId);
  return { ok: true as const };
}
