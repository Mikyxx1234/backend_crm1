import type { ConversationStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";
import {
  assignConversationAssignedTo,
  getConversationById,
  updateConversationStatusInDb,
} from "@/services/conversations";
import { createDealEvent } from "@/services/deals";

async function logDealEventsForConversationContact(
  conversationId: string,
  userId: string,
  type: "CONVERSATION_STATUS_CHANGED" | "ASSIGNEE_CHANGED",
  meta: Record<string, unknown>,
) {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contactId: true, channel: true },
    });
    if (!conv?.contactId) return;
    const deals = await prisma.deal.findMany({
      where: { contactId: conv.contactId, status: "OPEN" },
      select: { id: true },
    });
    const fullMeta = { conversationId, channel: conv.channel, ...meta };
    await Promise.all(
      deals.map((d) => createDealEvent(d.id, userId, type, fullMeta)),
    );
  } catch {
    /* no-op */
  }
}

type RouteContext = { params: Promise<{ id: string }> };

const VALID_ACTIONS = new Set(["resolve", "reopen", "toggle_status", "assign"]);
const VALID_STATUSES = new Set(["OPEN", "RESOLVED", "PENDING", "SNOOZED"]);

function actionToDbStatus(action: string, rawStatus?: string): ConversationStatus | null {
  if (action === "resolve") return "RESOLVED";
  if (action === "reopen") return "OPEN";
  if (action === "toggle_status" && rawStatus) {
    const upper = rawStatus.toUpperCase();
    if (VALID_STATUSES.has(upper)) return upper as ConversationStatus;
  }
  return null;
}

export async function POST(request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    try {

      const { id } = await context.params;

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
      }

      const b = body as Record<string, unknown>;
      const action = typeof b.action === "string" ? b.action : "";

      if (!VALID_ACTIONS.has(action)) {
        return NextResponse.json(
          { message: "action inválida (resolve, reopen, toggle_status, assign)." },
          { status: 400 }
        );
      }

      if (action === "assign") {
        const gate = await requireConversationAccess(session, id);
        if (gate) return gate;
        if (!("assignedToId" in b)) {
          return NextResponse.json(
            { message: "Informe assignedToId (id do usuário ou null para desatribuir)." },
            { status: 400 }
          );
        }
        const raw = b.assignedToId;
        let newAssigneeId: string | null;
        if (raw === null) {
          newAssigneeId = null;
        } else if (typeof raw === "string" && raw.trim() !== "") {
          newAssigneeId = raw.trim();
        } else {
          return NextResponse.json({ message: "assignedToId inválido." }, { status: 400 });
        }
        const user = session.user as { id: string; role: "ADMIN" | "MANAGER" | "MEMBER" };
        const prev = await prisma.conversation.findUnique({
          where: { id },
          select: { assignedToId: true, assignedTo: { select: { id: true, name: true } } },
        });
        const result = await assignConversationAssignedTo(id, newAssigneeId, user);
        if (!result.ok) {
          const status =
            result.code === "NOT_FOUND" ? 404 : result.code === "USER_NOT_FOUND" ? 400 : 403;
          const msg =
            result.code === "USER_NOT_FOUND"
              ? "Usuário não encontrado."
              : result.code === "NOT_FOUND"
                ? "Conversa não encontrada."
                : "Sem permissão para esta atribuição.";
          return NextResponse.json({ message: msg }, { status });
        }
        if ((prev?.assignedToId ?? null) !== (result.conversation.assignedToId ?? null)) {
          await logDealEventsForConversationContact(id, user.id, "ASSIGNEE_CHANGED", {
            from: prev?.assignedTo ?? null,
            to: result.conversation.assignedTo ?? null,
          });
        }

        return NextResponse.json(
          {
            conversation: {
              id: result.conversation.id,
              status: result.conversation.status,
              externalId: result.conversation.externalId,
              assignedToId: result.conversation.assignedToId,
              assignedTo: result.conversation.assignedTo,
            },
          }
        );
      }

      const gate = await requireConversationAccess(session, id);
      if (gate) return gate;

      const conv = await getConversationById(id);
      if (!conv) {
        return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
      }

      const rawStatus = typeof b.status === "string" ? b.status : undefined;
      const dbStatus = actionToDbStatus(action, rawStatus);

      if (!dbStatus) {
        return NextResponse.json(
          { message: "status inválido (OPEN, RESOLVED, PENDING, SNOOZED)." },
          { status: 400 }
        );
      }

      const updated = await updateConversationStatusInDb(id, dbStatus);

      if (conv.status !== updated.status) {
        const uid = (session.user as { id: string }).id;
        await logDealEventsForConversationContact(id, uid, "CONVERSATION_STATUS_CHANGED", {
          from: conv.status,
          to: updated.status,
          action,
        });
      }

      return NextResponse.json({
        conversation: {
          id: updated.id,
          status: updated.status,
          externalId: updated.externalId,
        },
      });
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Erro ao atualizar conversa.";
      return NextResponse.json({ message: msg }, { status: 500 });
    }
  });
}
