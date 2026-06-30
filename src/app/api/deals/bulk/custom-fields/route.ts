import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import type { AppUserRole } from "@/lib/auth-types";
import {
  requirePermissionForUser,
  requirePipelineScope,
} from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getVisibilityFilter } from "@/lib/visibility";
import {
  LEADS_BULK_JOB_NAMES,
  enqueueLeadsBulk,
  type BulkContactNativePatch,
  type BulkDealNativePatch,
} from "@/lib/queue";
import { isValidDealStatus, resolveBoardDealIds } from "@/services/deals";
import { parseAdvancedDealFilters } from "@/services/kanban-filters";

/**
 * POST /api/deals/bulk/custom-fields
 *
 * Atualiza custom fields em massa para múltiplos deals.
 *
 * Funcionalidade NOVA — antes desta rota só era possível PUT por deal,
 * o que tornava bulk de N deals × M campos = N requests HTTP, cada uma
 * abrindo `prisma.$transaction` separada. Inviável para volumes acima
 * de ~100 deals.
 *
 * Comportamento:
 *   - Sempre enfileira no worker (não tem modo síncrono). Operações
 *     custom-field em massa são pesadas por natureza (cada deal abre uma
 *     transação interna no `upsertDealCustomFieldValues`), então a
 *     resposta da API é sempre 202 com `operationId`.
 *   - Frontend pollar via GET /api/bulk-operations/[id] para progresso.
 *
 * Idempotência:
 *   - Aplicar o mesmo valor a um custom field é no-op natural (upsert).
 *   - Retry do job não causa side effect — custom fields não disparam
 *     triggers de automação no projeto atual.
 */

const FieldValueSchema = z.object({
  fieldId: z.string().min(1),
  value: z.string(),
});

const BodySchema = z.object({
  /**
   * IDs explícitos dos deals (seleção manual na tela). Opcional quando
   * `scope` é informado — nesse caso o servidor resolve os IDs.
   */
  dealIds: z
    .array(z.string().min(1))
    .max(5000, "Máximo de 5000 deals por operação")
    .optional()
    .default([]),
  /**
   * Seleção "todos que batem no filtro": o servidor expande para os IDs
   * reais (respeitando visibilidade + filtros do board). `stageId` opcional
   * restringe a uma única etapa; sem ele, abrange o pipeline inteiro.
   */
  scope: z
    .object({
      pipelineId: z.string().min(1),
      status: z.string().optional(),
      stageId: z.string().optional(),
      filters: z.unknown().optional(),
    })
    .optional(),
  /** Custom fields de DEAL (compat histórico — agora opcional). */
  updates: z
    .array(FieldValueSchema)
    .max(50, "Máximo de 50 campos por operação")
    .optional()
    .default([]),
  /** Custom fields de CONTATO vinculado. */
  contactCustom: z
    .array(FieldValueSchema)
    .max(50, "Máximo de 50 campos por operação")
    .optional()
    .default([]),
  /** Campos nativos do Deal. */
  dealNative: z
    .object({
      title: z.string().optional(),
      value: z.string().optional(),
      expectedClose: z.string().optional(),
    })
    .optional(),
  /** Campos nativos do Contato vinculado. */
  contactNative: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      source: z.string().optional(),
    })
    .optional(),
  /** Tags a adicionar no Deal (por ID existente ou nome a resolver/criar). */
  tags: z
    .array(z.object({ tagId: z.string().optional(), tagName: z.string().optional() }))
    .max(50, "Máximo de 50 tags por operação")
    .optional()
    .default([]),
});

/**
 * Filtra um patch de campos nativos mantendo só chaves com string não-vazia
 * (skip-empty). Retorna `undefined` se nada sobrar.
 */
function sanitizeNative<T extends Record<string, string | undefined>>(
  raw: T | undefined,
): Partial<T> | undefined {
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v.trim().length > 0) out[k] = v.trim();
  }
  return Object.keys(out).length > 0 ? (out as Partial<T>) : undefined;
}

export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    const user = session.user as {
      id: string;
      organizationId: string | null;
      role?: string | null;
      isSuperAdmin?: boolean;
    };

    const denied = await requirePermissionForUser(user, "deal:edit");
    if (denied) return denied;

    let body: unknown;
    // (parse + gates de contato abaixo)
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { message: "Body JSON inválido." },
        { status: 400 },
      );
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Payload inválido.",
          errors: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }

    const { updates, contactCustom, tags, scope } = parsed.data;

    if (!user.organizationId) {
      return NextResponse.json(
        { message: "Operação requer contexto de organização." },
        { status: 403 },
      );
    }
    const orgId = user.organizationId;

    // Resolve a lista de deals: por IDs explícitos OU por `scope` (todos que
    // batem no filtro). Scope tem prioridade quando informado.
    let dealIds = parsed.data.dealIds;
    let scopeCapped = false;
    if (scope) {
      const scopeDenied = await requirePipelineScope(user, "view", scope.pipelineId);
      if (scopeDenied) return scopeDenied;

      // Espelha a visibilidade do board (MEMBER só vê os próprios).
      const visibility = await getVisibilityFilter(
        user as { id: string; role: AppUserRole },
      );
      const visibilityOwnerId = visibility.canSeeAll ? null : user.id;

      const statusFilter =
        scope.status === "ALL"
          ? ("ALL" as const)
          : scope.status && isValidDealStatus(scope.status)
            ? (scope.status as "OPEN" | "WON" | "LOST")
            : undefined;

      const resolved = await resolveBoardDealIds(scope.pipelineId, {
        visibilityOwnerId,
        statusFilter,
        filters: parseAdvancedDealFilters(scope.filters),
        stageId: scope.stageId,
        cap: 5000,
      });
      dealIds = resolved.ids;
      scopeCapped = resolved.capped;
    }

    if (dealIds.length === 0) {
      return NextResponse.json(
        { message: "Nenhum negócio na seleção." },
        { status: 400 },
      );
    }

    // Normaliza campos nativos (skip-empty).
    const dealNative = sanitizeNative(parsed.data.dealNative) as
      | BulkDealNativePatch
      | undefined;
    const contactNative = sanitizeNative(parsed.data.contactNative) as
      | BulkContactNativePatch
      | undefined;

    const touchesContact =
      contactCustom.length > 0 || contactNative !== undefined;

    // Gate adicional: mexer em campos de contato exige `contact:edit`.
    if (touchesContact) {
      const deniedContact = await requirePermissionForUser(user, "contact:edit");
      if (deniedContact) return deniedContact;
    }

    // Exige ao menos uma alteração (qualquer fonte).
    const hasAnyWork =
      updates.length > 0 ||
      contactCustom.length > 0 ||
      dealNative !== undefined ||
      contactNative !== undefined ||
      tags.length > 0;
    if (!hasAnyWork) {
      return NextResponse.json(
        { message: "Informe ao menos um campo ou tag para atualizar." },
        { status: 400 },
      );
    }

    // Valida campos nativos do Deal (numérico/data) antes de enfileirar.
    if (dealNative?.value !== undefined && !Number.isFinite(Number(dealNative.value))) {
      return NextResponse.json(
        { message: "Valor do negócio inválido (deve ser numérico)." },
        { status: 400 },
      );
    }
    if (
      dealNative?.expectedClose !== undefined &&
      Number.isNaN(new Date(dealNative.expectedClose).getTime())
    ) {
      return NextResponse.json(
        { message: "Data de previsão de fechamento inválida." },
        { status: 400 },
      );
    }

    // Pré-validação leve: confirma ownership básico dos deals (Prisma
    // extension faz o filtro automático). Sem isso, criar BulkOperation
    // com IDs inválidos resultaria em uma operação "vazia" registrada.
    const validDeals = await prisma.deal.findMany({
      where: { id: { in: dealIds } },
      select: { id: true },
    });
    if (validDeals.length === 0) {
      return NextResponse.json(
        { message: "Nenhum deal válido na seleção." },
        { status: 404 },
      );
    }

    // Resolve as tags (por ID ou por nome) em IDs concretos. Criação por
    // nome exige ADMIN/MANAGER — mesma regra de POST /api/deals/:id/tags.
    // Feita aqui (não no worker) porque é onde temos o `role` do usuário.
    let resolvedTagIds: string[] = [];
    try {
      resolvedTagIds = await resolveTagIds(tags, orgId, user.role as AppUserRole);
    } catch (err) {
      if (err instanceof Error && err.message === "TAG_CREATE_FORBIDDEN") {
        return NextResponse.json(
          { message: "Sem permissão para criar tags. Selecione tags existentes." },
          { status: 403 },
        );
      }
      throw err;
    }

    // Cria registro do BulkOperation antes de enfileirar — Postgres é
    // fonte da verdade. Se o enqueue falhar, a operação fica em PENDING
    // e podemos identificar/recuperar via dashboard.
    const operation = await prisma.bulkOperation.create({
      data: {
        type: "DEAL_BULK_UPDATE_FIELDS",
        status: "PENDING",
        total: validDeals.length,
        payload: {
          dealIds: validDeals.map((d) => d.id),
          updates,
          contactCustom,
          dealNative: dealNative ?? null,
          contactNative: contactNative ?? null,
          tagIds: resolvedTagIds,
        },
        createdById: user.id,
      },
      select: { id: true },
    });

    const job = await enqueueLeadsBulk(LEADS_BULK_JOB_NAMES.bulkUpdateFields, {
      operationId: operation.id,
      organizationId: orgId,
      initiatedByUserId: user.id,
      dealIds: validDeals.map((d) => d.id),
      updates,
      contactCustom,
      dealNative,
      contactNative,
      tagIds: resolvedTagIds,
    });

    if (!job) {
      // Redis indisponível — marcar operação como FAILED para o frontend
      // não esperar para sempre, e responder 503 explícito.
      await prisma.bulkOperation.update({
        where: { id: operation.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errors: [
            {
              itemId: "__operation__",
              message: "Fila de jobs indisponível (Redis offline)",
              attempt: 0,
              at: new Date().toISOString(),
            },
          ],
        },
      });
      return NextResponse.json(
        {
          message: "Fila de jobs indisponível.",
          operationId: operation.id,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        message: "Operação enfileirada.",
        operationId: operation.id,
        total: validDeals.length,
        // true quando o `scope` resolveu mais que o teto (5000) e foi cortado.
        capped: scopeCapped,
      },
      { status: 202 },
    );
  });
}

/**
 * Resolve uma lista de tags (por `tagId` existente ou `tagName`) em IDs
 * concretos, deduplicados. Tags por nome inexistentes são criadas apenas se
 * o usuário for ADMIN/MANAGER — caso contrário lança `TAG_CREATE_FORBIDDEN`.
 */
async function resolveTagIds(
  tags: Array<{ tagId?: string; tagName?: string }>,
  orgId: string,
  role: AppUserRole,
): Promise<string[]> {
  const ids = new Set<string>();
  for (const t of tags) {
    const tagId = typeof t.tagId === "string" ? t.tagId.trim() : "";
    const tagName = typeof t.tagName === "string" ? t.tagName.trim() : "";
    if (tagId) {
      ids.add(tagId);
      continue;
    }
    if (!tagName) continue;
    const existing = await prisma.tag.findUnique({
      where: { organizationId_name: { organizationId: orgId, name: tagName } },
      select: { id: true },
    });
    if (existing) {
      ids.add(existing.id);
      continue;
    }
    if (role !== "ADMIN" && role !== "MANAGER") {
      throw new Error("TAG_CREATE_FORBIDDEN");
    }
    const created = await prisma.tag.create({
      data: withOrgFromCtx({ name: tagName }),
      select: { id: true },
    });
    ids.add(created.id);
  }
  // Confere que todos os IDs (inclusive os passados por tagId) pertencem à org.
  const valid = await prisma.tag.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true },
  });
  return valid.map((v) => v.id);
}
