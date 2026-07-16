import type { ConversationStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";
import {
  assignConversationAssignedTo,
  getConversationById,
  updateConversationStatusInDb,
  withConversationNumberRetry,
} from "@/services/conversations";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { fireTrigger } from "@/services/automation-triggers";
import { createDealEvent } from "@/services/deals";
import { logEvent } from "@/services/activity-log";

async function logDealEventsForConversationContact(
  conversationId: string,
  userId: string,
  type: "CONVERSATION_STATUS_CHANGED" | "CONVERSATION_CLOSED" | "CONVERSATION_REOPENED" | "ASSIGNEE_CHANGED",
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
          // Evento da própria conversa — independe de haver deal aberto.
          // Reusa o tipo ASSIGNEE_CHANGED (já mapeado no EVENT_CONFIG do
          // feed); o entityType=CONVERSATION distingue do escopo deal.
          void logEvent({
            type: "ASSIGNEE_CHANGED",
            entityType: "CONVERSATION",
            entityId: id,
            entityLabel: result.conversation.externalId ?? null,
            conversationId: id,
            contactId: result.conversation.contactId ?? null,
            field: "assignedTo",
            oldValue: prev?.assignedTo?.name ?? null,
            newValue: result.conversation.assignedTo?.name ?? null,
            meta: {
              fromUserId: prev?.assignedToId ?? null,
              toUserId: result.conversation.assignedToId ?? null,
            },
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

      // Modelo de ticket (aprovado 15/jul/26): action="reopen" NAO promove
      // a conversa antiga de RESOLVED->OPEN. Ao inves disso, cria uma
      // NOVA conversa vinculada ao mesmo contato/canal, com #N+1, e
      // retorna o novo id para o frontend redirecionar. Assim cada ciclo
      // vira um "ticket" independente com timeline propria. Ver
      // AGENT.md "ID de conversa + ticket".
      if (action === "reopen") {
        if (conv.status !== "RESOLVED") {
          return NextResponse.json(
            { message: "Só é possível reabrir conversas encerradas." },
            { status: 400 },
          );
        }
        if (!conv.contact?.id) {
          return NextResponse.json(
            { message: "Conversa sem contato vinculado — não é possível abrir novo ticket." },
            { status: 400 },
          );
        }

        // Snapshot dos campos relevantes da conversa origem — nao carrega
        // no `getConversationById` por padrao, entao lê agora.
        const src = await prisma.conversation.findUnique({
          where: { id },
          select: {
            channel: true,
            channelId: true,
            inboxName: true,
            assignedToId: true,
            contactId: true,
          },
        });
        if (!src?.contactId) {
          return NextResponse.json(
            { message: "Conversa origem inconsistente." },
            { status: 500 },
          );
        }

        const created = await withConversationNumberRetry((number) =>
          prisma.conversation.create({
            data: withOrgFromCtx({
              number,
              channel: src.channel,
              status: "OPEN" as const,
              inboxName: src.inboxName ?? null,
              contactId: src.contactId!,
              ...(src.channelId ? { channelId: src.channelId } : {}),
              ...(src.assignedToId ? { assignedToId: src.assignedToId } : {}),
            }),
            select: {
              id: true,
              number: true,
              status: true,
              externalId: true,
              channel: true,
              channelId: true,
              inboxName: true,
              contactId: true,
              assignedToId: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
        );

        const uid = (session.user as { id: string }).id;

        // Log de rastreabilidade: conversa origem ganha um evento REOPENED
        // apontando pro novo ticket; a nova ganha CREATED (padrao).
        void logEvent({
          type: "CONVERSATION_REOPENED",
          entityType: "CONVERSATION",
          entityId: id,
          entityLabel: conv.externalId ?? null,
          conversationId: id,
          contactId: conv.contact.id,
          field: "status",
          oldValue: "RESOLVED",
          newValue: "OPEN",
          meta: { action, newConversationId: created.id, newNumber: created.number },
        });
        void logEvent({
          type: "CONVERSATION_CREATED",
          entityType: "CONVERSATION",
          entityId: created.id,
          entityLabel: null,
          conversationId: created.id,
          contactId: conv.contact.id,
          meta: {
            channel: created.channel,
            inboxName: created.inboxName,
            source: "reopen",
            previousConversationId: id,
          },
        });
        await logDealEventsForConversationContact(id, uid, "CONVERSATION_REOPENED", {
          action,
          newConversationId: created.id,
          newNumber: created.number,
        });

        // Dispara automacao — cada ticket ativa "boas-vindas"/SLA de novo.
        fireTrigger("conversation_created", {
          contactId: conv.contact.id,
          data: {
            channel: created.channel,
            inboxName: created.inboxName,
            source: "reopen",
            previousConversationId: id,
          },
        }).catch(() => {
          /* fire-and-forget */
        });

        return NextResponse.json({
          conversation: {
            id: created.id,
            number: created.number,
            status: created.status,
            externalId: created.externalId,
            channel: created.channel,
            channelId: created.channelId,
            inboxName: created.inboxName,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          },
          previousConversationId: id,
        });
      }

      const rawStatus = typeof b.status === "string" ? b.status : undefined;
      const dbStatus = actionToDbStatus(action, rawStatus);

      if (!dbStatus) {
        return NextResponse.json(
          { message: "status inválido (OPEN, RESOLVED, PENDING, SNOOZED)." },
          { status: 400 }
        );
      }

      // Modelo de ticket: RESOLVED e' terminal. Nao permite `toggle_status`
      // promover para OPEN/PENDING/SNOOZED — o unico caminho pos-encerramento
      // e' via `action=reopen` (que cria ticket novo). Ver bloco acima.
      if (conv.status === "RESOLVED" && dbStatus !== "RESOLVED") {
        return NextResponse.json(
          { message: "Conversa encerrada — use `reopen` para abrir novo ticket." },
          { status: 400 },
        );
      }

      const updated = await updateConversationStatusInDb(id, dbStatus);

      if (conv.status !== updated.status) {
        const uid = (session.user as { id: string }).id;

        // Tipo específico: CONVERSATION_CLOSED / CONVERSATION_REOPENED /
        // CONVERSATION_STATUS_CHANGED — usado em ambos os logs (deal + conversa)
        // para facilitar filtros e exibição no feed/timeline.
        const convEventType =
          updated.status === "RESOLVED"
            ? "CONVERSATION_CLOSED"
            : conv.status === "RESOLVED" && updated.status === "OPEN"
              ? "CONVERSATION_REOPENED"
              : "CONVERSATION_STATUS_CHANGED";

        const statusMeta = {
          from: conv.status,
          to: updated.status,
          action,
        };

        // Grava no log de cada deal aberto do contato com o tipo correto.
        await logDealEventsForConversationContact(id, uid, convEventType, statusMeta);

        // Evento da própria conversa (sem dealId) — registra no feed global.
        void logEvent({
          type: convEventType,
          entityType: "CONVERSATION",
          entityId: id,
          entityLabel: updated.externalId ?? null,
          conversationId: id,
          contactId: conv.contact?.id ?? null,
          field: "status",
          oldValue: conv.status,
          newValue: updated.status,
          meta: { action },
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
