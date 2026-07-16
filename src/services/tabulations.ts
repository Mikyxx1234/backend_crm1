import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/request-context";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

/**
 * Tabulacoes de atendimento — arvore por departamento.
 *
 * Regras invariantes garantidas aqui (nao delegar pra rota):
 *   - Toda operacao filtra por org do contexto (Prisma extension ja
 *     injeta em SCOPED_MODELS, mas mantemos where explicito por
 *     defesa/documentacao).
 *   - `parent.departmentId === node.departmentId` (arvore homogenea).
 *   - Ao mover/renomear/desativar, `position` eh gerenciada pelo caller
 *     (default = max+1 na criacao).
 *
 * A escolha do agente ao encerrar exige uma FOLHA (usar
 * `assertLeafInDepartment`).
 */

export type TabulationNode = {
  id: string;
  parentId: string | null;
  name: string;
  color: string | null;
  position: number;
  active: boolean;
  children: TabulationNode[];
};

function orgIdOrThrow(): string {
  const ctx = getRequestContext();
  const orgId = ctx?.organizationId;
  if (!orgId) throw new Error("Sem organizationId no contexto.");
  return orgId;
}

export async function listByDepartment(departmentId: string) {
  const orgId = orgIdOrThrow();
  return prisma.tabulation.findMany({
    where: { organizationId: orgId, departmentId },
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });
}

export async function getTree(departmentId: string): Promise<TabulationNode[]> {
  const rows = await listByDepartment(departmentId);
  const byId = new Map<string, TabulationNode>();
  rows.forEach((r) => {
    byId.set(r.id, {
      id: r.id,
      parentId: r.parentId,
      name: r.name,
      color: r.color,
      position: r.position,
      active: r.active,
      children: [],
    });
  });
  const roots: TabulationNode[] = [];
  byId.forEach((node) => {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortRec = (arr: TabulationNode[]) => {
    arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    arr.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/** Retorna [rootId, ..., leafId] (inclui o proprio id ao fim). */
export async function getAncestors(id: string): Promise<string[]> {
  const orgId = orgIdOrThrow();
  const chain: string[] = [];
  let cursor: { id: string; parentId: string | null } | null =
    await prisma.tabulation.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, parentId: true },
    });
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    chain.push(cursor.id);
    if (!cursor.parentId) break;
    cursor = await prisma.tabulation.findFirst({
      where: { id: cursor.parentId, organizationId: orgId },
      select: { id: true, parentId: true },
    });
  }
  return chain.reverse();
}

/**
 * Garante que `id` existe, pertence ao `departmentId` E eh folha (sem
 * filhos). Lanca com `code` estavel pra rota mapear pra 400.
 */
export async function assertLeafInDepartment(
  id: string,
  departmentId: string,
): Promise<void> {
  const orgId = orgIdOrThrow();
  const node = await prisma.tabulation.findFirst({
    where: { id, organizationId: orgId, departmentId, active: true },
    select: { id: true, _count: { select: { children: true } } },
  });
  if (!node) {
    const err = new Error("Tabulacao invalida para este departamento.");
    (err as { code?: string }).code = "TABULATION_INVALID";
    throw err;
  }
  if (node._count.children > 0) {
    const err = new Error("Selecione uma tabulacao folha.");
    (err as { code?: string }).code = "TABULATION_NOT_LEAF";
    throw err;
  }
}

export async function createNode(input: {
  departmentId: string;
  parentId?: string | null;
  name: string;
  color?: string | null;
}) {
  const orgId = orgIdOrThrow();
  // Se `parentId` foi passado, ele DEVE existir na mesma org+dept.
  if (input.parentId) {
    const parent = await prisma.tabulation.findFirst({
      where: {
        id: input.parentId,
        organizationId: orgId,
        departmentId: input.departmentId,
      },
      select: { id: true },
    });
    if (!parent) {
      const err = new Error("Pai invalido.");
      (err as { code?: string }).code = "PARENT_INVALID";
      throw err;
    }
  }
  const maxPos = await prisma.tabulation.aggregate({
    where: {
      organizationId: orgId,
      departmentId: input.departmentId,
      parentId: input.parentId ?? null,
    },
    _max: { position: true },
  });
  const position = (maxPos._max.position ?? -1) + 1;
  return prisma.tabulation.create({
    data: withOrgFromCtx({
      departmentId: input.departmentId,
      parentId: input.parentId ?? null,
      name: input.name.trim(),
      color: input.color ?? null,
      position,
    }),
  });
}

export async function updateNode(
  id: string,
  patch: {
    name?: string;
    color?: string | null;
    parentId?: string | null;
    position?: number;
    active?: boolean;
  },
) {
  const orgId = orgIdOrThrow();
  const node = await prisma.tabulation.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, departmentId: true, parentId: true },
  });
  if (!node) {
    const err = new Error("Tabulacao nao encontrada.");
    (err as { code?: string }).code = "NOT_FOUND";
    throw err;
  }
  if (patch.parentId !== undefined && patch.parentId !== null) {
    if (patch.parentId === id) {
      const err = new Error("Uma tabulacao nao pode ser pai de si mesma.");
      (err as { code?: string }).code = "CYCLE";
      throw err;
    }
    const parent = await prisma.tabulation.findFirst({
      where: {
        id: patch.parentId,
        organizationId: orgId,
        departmentId: node.departmentId,
      },
      select: { id: true },
    });
    if (!parent) {
      const err = new Error("Pai invalido.");
      (err as { code?: string }).code = "PARENT_INVALID";
      throw err;
    }
    // Impedir mover um nó pra baixo de um descendente dele (ciclo).
    const ancestors = await getAncestors(patch.parentId);
    if (ancestors.includes(id)) {
      const err = new Error("Movimento formaria um ciclo.");
      (err as { code?: string }).code = "CYCLE";
      throw err;
    }
  }
  const data: Record<string, unknown> = {};
  if (typeof patch.name === "string" && patch.name.trim()) data.name = patch.name.trim();
  if (patch.color !== undefined) data.color = patch.color;
  if (patch.parentId !== undefined) data.parentId = patch.parentId;
  if (typeof patch.position === "number") data.position = patch.position;
  if (typeof patch.active === "boolean") data.active = patch.active;
  return prisma.tabulation.update({ where: { id }, data });
}

export async function deleteNode(id: string) {
  const orgId = orgIdOrThrow();
  const node = await prisma.tabulation.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  });
  if (!node) {
    const err = new Error("Tabulacao nao encontrada.");
    (err as { code?: string }).code = "NOT_FOUND";
    throw err;
  }
  // Cascade por FK. Conversation.tabulationId -> SET NULL preserva historico.
  await prisma.tabulation.delete({ where: { id } });
}
