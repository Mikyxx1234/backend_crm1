import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { LEADS_BULK_JOB_NAMES, enqueueLeadsBulk } from "@/lib/queue";

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

const BodySchema = z.object({
  dealIds: z
    .array(z.string().min(1))
    .min(1, "Selecione ao menos 1 deal")
    .max(5000, "Máximo de 5000 deals por operação"),
  updates: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        value: z.string(),
      }),
    )
    .min(1, "Informe ao menos 1 campo")
    .max(50, "Máximo de 50 campos por operação"),
});

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

    const { dealIds, updates } = parsed.data;

    if (!user.organizationId) {
      return NextResponse.json(
        { message: "Operação requer contexto de organização." },
        { status: 403 },
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
        },
        createdById: user.id,
      },
      select: { id: true },
    });

    const job = await enqueueLeadsBulk(LEADS_BULK_JOB_NAMES.bulkUpdateFields, {
      operationId: operation.id,
      organizationId: user.organizationId,
      initiatedByUserId: user.id,
      dealIds: validDeals.map((d) => d.id),
      updates,
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
      },
      { status: 202 },
    );
  });
}
