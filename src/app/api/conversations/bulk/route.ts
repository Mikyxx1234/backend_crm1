import { NextResponse } from "next/server";

import type { Prisma } from "@prisma/client";

import { withOrgContext } from "@/lib/auth-helpers";
import { getVisibilityFilter } from "@/lib/visibility";
import { getOrgSettingBool } from "@/lib/org-settings";
import { prisma } from "@/lib/prisma";
import { LEADS_BULK_JOB_NAMES, enqueueLeadsBulk } from "@/lib/queue";

/**
 * POST /api/conversations/bulk
 *
 * Ações em massa sobre conversas do inbox.
 *
 * `resolve` (Encerrar): processado de forma ASSÍNCRONA pelo `leads-worker`
 * (fila `leads-bulk`, mesma infra dos bulk de Deals). A rota:
 *   1. aplica o filtro de visibilidade do usuário;
 *   2. remove ids de departamentos que exigem tabulação ao encerrar (`skipped`);
 *   3. lê as org settings keepAgent/keepDepartment;
 *   4. cria um `BulkOperation` (PENDING) e enfileira o job;
 *   5. responde 202 com `operationId` — o frontend pollar via
 *      GET /api/bulk-operations/[id].
 *
 * Motivo do async: em produção a API e o worker são deploys separados; o
 * encerramento síncrono de muitas conversas estourava (timeout / erro),
 * então a operação pesada foi movida pro worker dedicado.
 */
export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    try {
      const user = session.user as {
        id: string;
        role: "ADMIN" | "MANAGER" | "MEMBER";
        organizationId?: string | null;
      };
      const { conversationWhere } = await getVisibilityFilter(user);
      const scopedWhere = (ids: string[], extra: Prisma.ConversationWhereInput) => {
        const idIn: Prisma.ConversationWhereInput = { id: { in: ids } };
        if (!conversationWhere || Object.keys(conversationWhere).length === 0) {
          return { AND: [idIn, extra] };
        }
        return { AND: [idIn, conversationWhere, extra] };
      };

      const body = (await request.json()) as { ids?: string[]; action?: string };
      const { ids, action } = body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json({ message: "Nenhuma conversa selecionada." }, { status: 400 });
      }
      if (ids.length > 500) {
        return NextResponse.json({ message: "Máximo 500 conversas por vez." }, { status: 400 });
      }

      switch (action) {
        case "resolve": {
          if (!user.organizationId) {
            return NextResponse.json(
              { message: "Operação requer contexto de organização." },
              { status: 403 },
            );
          }

          // Departamentos que exigem tabulação ao encerrar NÃO entram no bulk
          // (o encerramento individual colhe a tabulação). Devolvemos a lista
          // pra UI avisar "encerre individualmente".
          const skippedRows = await prisma.conversation.findMany({
            where: scopedWhere(ids, {
              status: { not: "RESOLVED" },
              department: { is: { requireTabulationOnClose: true } },
            }),
            select: { id: true },
          });
          const skippedIds = skippedRows.map((c) => c.id);
          const skippedSet = new Set(skippedIds);
          const candidateIds = ids.filter((i) => !skippedSet.has(i));

          // Resolve os ids REAIS a encerrar já com visibilidade aplicada —
          // o worker roda em system-context (sem a visibilidade do usuário),
          // então a checagem de escopo precisa acontecer aqui.
          const targets = candidateIds.length
            ? await prisma.conversation.findMany({
                where: scopedWhere(candidateIds, { status: { not: "RESOLVED" } }),
                select: { id: true },
              })
            : [];
          const targetIds = targets.map((c) => c.id);

          if (targetIds.length === 0) {
            return NextResponse.json({ updated: 0, skipped: skippedIds });
          }

          const [keepAgent, keepDepartment] = await Promise.all([
            getOrgSettingBool("conversation.keepAgentOnEnd", false),
            getOrgSettingBool("conversation.keepDepartmentOnEnd", false),
          ]);

          const operation = await prisma.bulkOperation.create({
            data: {
              type: "CONVERSATION_BULK_RESOLVE",
              status: "PENDING",
              total: targetIds.length,
              payload: { conversationIds: targetIds, keepAgent, keepDepartment },
              createdById: user.id,
            },
            select: { id: true },
          });

          const job = await enqueueLeadsBulk(LEADS_BULK_JOB_NAMES.bulkResolveConversations, {
            operationId: operation.id,
            organizationId: user.organizationId,
            initiatedByUserId: user.id,
            conversationIds: targetIds,
            keepAgent,
            keepDepartment,
          });

          if (!job) {
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
              { message: "Fila de jobs indisponível.", operationId: operation.id },
              { status: 503 },
            );
          }

          return NextResponse.json(
            {
              message: "Encerramento em massa enfileirado.",
              operationId: operation.id,
              total: targetIds.length,
              skipped: skippedIds,
              action: "resolve",
            },
            { status: 202 },
          );
        }
        case "reopen": {
          // Modelo de ticket (15/jul/26): "reopen" nao promove RESOLVED->OPEN;
          // cada reabertura vira ticket novo (`#N+1`). Nao expomos bulk aqui —
          // o operador deve reabrir 1 a 1 pelo kebab da conversa, pra ver o
          // novo `#N` e navegar. Ver AGENT.md "ID de conversa + ticket".
          return NextResponse.json(
            {
              message:
                "Reabertura em massa não é suportada no modo ticket. Reabra individualmente pelo kebab da conversa.",
            },
            { status: 400 },
          );
        }
        default:
          return NextResponse.json({ message: `Ação desconhecida: ${action}` }, { status: 400 });
      }
    } catch (e) {
      console.error("[bulk]", e);
      return NextResponse.json({ message: "Erro ao executar ação em massa." }, { status: 500 });
    }
  });
}
