import { NextResponse } from "next/server";

import type { Prisma } from "@prisma/client";

import { auth } from "@/lib/auth";
import { getVisibilityFilter } from "@/lib/visibility";
import { getOrgSettingBool } from "@/lib/org-settings";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/services/activity-log";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const user = session.user as { id: string; role: "ADMIN" | "MANAGER" | "MEMBER" };
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
    if (ids.length > 200) {
      return NextResponse.json({ message: "Máximo 200 conversas por vez." }, { status: 400 });
    }

    const logBulkStatus = async (
      changedIds: string[],
      from: string,
      to: string,
      type: "CONVERSATION_CLOSED" | "CONVERSATION_REOPENED",
    ) => {
      const convs = await prisma.conversation.findMany({
        where: { id: { in: changedIds } },
        select: { id: true, contactId: true, contact: { select: { name: true } } },
      });
      await Promise.all(
        convs.map((c) =>
          logEvent({
            type,
            entityType: "CONVERSATION",
            entityId: c.id,
            entityLabel: c.contact?.name ?? null,
            conversationId: c.id,
            contactId: c.contactId,
            field: "status",
            oldValue: from,
            newValue: to,
            meta: { from, to, source: "bulk" },
          }),
        ),
      );
    };

    switch (action) {
      case "resolve": {
        // Bulk NAO pergunta tabulacao. Se a conversa esta num departamento
        // que exige tabulacao ao encerrar, pulamos e devolvemos a lista
        // pra UI avisar "encerre individualmente" (o modal individual
        // colheu a tabulacao). Isso preserva o contrato de dados
        // (Conversation.tabulationId nunca nulo pra dept que exige).
        const skippedRows = await prisma.conversation.findMany({
          where: scopedWhere(ids, {
            status: { not: "RESOLVED" },
            department: { is: { requireTabulationOnClose: true } },
          }),
          select: { id: true },
        });
        const skippedIds = skippedRows.map((c) => c.id);
        const skippedSet = new Set(skippedIds);
        const effectiveIds = ids.filter((i) => !skippedSet.has(i));

        if (effectiveIds.length === 0) {
          return NextResponse.json({ updated: 0, skipped: skippedIds });
        }

        const toChange = await prisma.conversation.findMany({
          where: scopedWhere(effectiveIds, { status: { not: "RESOLVED" } }),
          select: { id: true },
        });
        // Respeita "Manter atendente/departamento ao finalizar" (default:
        // NÃO manter → desvincula). Mesmo comportamento do encerramento
        // individual (actions/route.ts).
        const [keepAgent, keepDepartment] = await Promise.all([
          getOrgSettingBool("conversation.keepAgentOnEnd", false),
          getOrgSettingBool("conversation.keepDepartmentOnEnd", false),
        ]);
        const result = await prisma.conversation.updateMany({
          where: scopedWhere(effectiveIds, { status: { not: "RESOLVED" } }),
          data: {
            status: "RESOLVED",
            closedAt: new Date(),
            ...(keepAgent ? {} : { assignedToId: null }),
            ...(keepDepartment ? {} : { departmentId: null }),
          },
        });
        void logBulkStatus(
          toChange.map((c) => c.id),
          "OPEN",
          "RESOLVED",
          "CONVERSATION_CLOSED",
        );
        return NextResponse.json({ updated: result.count, skipped: skippedIds });
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
}
