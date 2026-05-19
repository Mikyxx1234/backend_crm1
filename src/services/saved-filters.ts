/**
 * CRUD de filtros salvos.
 *
 * Regras:
 *  - Filtros privados (`isShared=false`) são visíveis apenas ao `userId` criador
 *    (e Super Admin / ADMIN da org? — decisão: ADMIN também enxerga
 *    privados? Hoje NÃO; só o dono e SuperAdmin via prismaBase).
 *  - Filtros compartilhados (`isShared=true`) são visíveis por toda a org.
 *  - Apenas o criador OU ADMIN/MANAGER da org podem editar/excluir filtros
 *    compartilhados.
 *  - `isDefault=true` é único por usuário+entityType (limpamos os outros
 *    do mesmo dono ao marcar).
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

export type SavedFilterInput = {
  name?: string;
  entityType?: string;
  filterConfig?: Record<string, unknown>;
  isShared?: boolean;
  isDefault?: boolean;
};

const DEFAULT_ENTITY = "kanban_deals";

export type SessionUserLike = {
  id: string;
  role: "ADMIN" | "MANAGER" | "MEMBER" | string;
};

function canManageShared(role: SessionUserLike["role"]): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

export async function listSavedFilters(user: SessionUserLike, entityType = DEFAULT_ENTITY) {
  // Prisma extension injeta organizationId no where.
  return prisma.savedFilter.findMany({
    where: {
      entityType,
      OR: [{ isShared: true }, { userId: user.id }],
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    include: { user: { select: { id: true, name: true } } },
  });
}

export async function getSavedFilterById(user: SessionUserLike, id: string) {
  const sf = await prisma.savedFilter.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!sf) return null;
  if (!sf.isShared && sf.userId !== user.id) return null;
  return sf;
}

export async function createSavedFilter(user: SessionUserLike, input: SavedFilterInput) {
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("Nome obrigatório.");

  const entityType = (input.entityType ?? DEFAULT_ENTITY).trim();
  const isShared = !!input.isShared;
  if (isShared && !canManageShared(user.role)) {
    throw new Error("Apenas administrador ou gestor pode criar filtros compartilhados.");
  }
  const isDefault = !!input.isDefault;

  if (isDefault) {
    // limpa outros defaults do mesmo dono+entityType
    await prisma.savedFilter.updateMany({
      where: { entityType, userId: user.id, isDefault: true },
      data: { isDefault: false },
    });
  }

  const created = await prisma.savedFilter.create({
    data: withOrgFromCtx({
      name,
      entityType,
      filterConfig: (input.filterConfig ?? {}) as Prisma.InputJsonValue,
      isShared,
      isDefault,
      userId: user.id,
    }),
  });
  return created;
}

export async function updateSavedFilter(
  user: SessionUserLike,
  id: string,
  input: SavedFilterInput,
) {
  const current = await prisma.savedFilter.findUnique({ where: { id } });
  if (!current) throw new Error("Filtro não encontrado.");
  // Só dono ou ADMIN/MANAGER (se shared) podem editar.
  const isOwner = current.userId === user.id;
  if (!isOwner && !(current.isShared && canManageShared(user.role))) {
    throw new Error("Sem permissão para editar este filtro.");
  }

  const data: Prisma.SavedFilterUncheckedUpdateInput = {};
  if (typeof input.name === "string" && input.name.trim()) data.name = input.name.trim();
  if (input.filterConfig !== undefined) {
    data.filterConfig = (input.filterConfig ?? {}) as Prisma.InputJsonValue;
  }
  if (typeof input.isShared === "boolean") {
    if (input.isShared && !canManageShared(user.role)) {
      throw new Error("Apenas administrador ou gestor pode compartilhar filtros.");
    }
    data.isShared = input.isShared;
  }
  if (typeof input.isDefault === "boolean") {
    data.isDefault = input.isDefault;
    if (input.isDefault) {
      await prisma.savedFilter.updateMany({
        where: { entityType: current.entityType, userId: user.id, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
  }

  const updated = await prisma.savedFilter.update({ where: { id }, data });
  return updated;
}

export async function deleteSavedFilter(user: SessionUserLike, id: string) {
  const current = await prisma.savedFilter.findUnique({ where: { id } });
  if (!current) return;
  const isOwner = current.userId === user.id;
  if (!isOwner && !(current.isShared && canManageShared(user.role))) {
    throw new Error("Sem permissão para excluir este filtro.");
  }
  await prisma.savedFilter.delete({ where: { id } });
}

export async function duplicateSavedFilter(user: SessionUserLike, id: string) {
  const src = await getSavedFilterById(user, id);
  if (!src) throw new Error("Filtro não encontrado.");
  const created = await prisma.savedFilter.create({
    data: withOrgFromCtx({
      name: `${src.name} (cópia)`,
      entityType: src.entityType,
      filterConfig: src.filterConfig as Prisma.InputJsonValue,
      isShared: false,
      isDefault: false,
      userId: user.id,
    }),
  });
  return created;
}
