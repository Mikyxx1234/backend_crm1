import type { ConversationStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requireConversationAccess } from "@/lib/conversation-access";
import { getOrgSettingBool } from "@/lib/org-settings";
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
import { sseBus } from "@/lib/sse-bus";
import { executeDistribution } from "@/services/distribution";
import { assertLeafInDepartment, getAncestors } from "@/services/tabulations";

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

const VALID_ACTIONS = new Set(["resolve", "reopen", "toggle_status", "assign", "transfer"]);
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
          { message: "action inválida (resolve, reopen, toggle_status, assign, transfer)." },
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

      // Transferência: encaminha a conversa para um AGENTE (assignedToId) e/ou
      // um DEPARTAMENTO (departmentId). Ao definir departamento, aciona a
      // Distribuição Inteligente escopada a esse departamento — um agente
      // elegível do departamento recebe a conversa automaticamente.
      if (action === "transfer") {
        const gate = await requireConversationAccess(session, id);
        if (gate) return gate;

        const hasAgent = "assignedToId" in b;
        const hasDept = "departmentId" in b;
        if (!hasAgent && !hasDept) {
          return NextResponse.json(
            { message: "Informe assignedToId e/ou departmentId." },
            { status: 400 },
          );
        }

        const user = session.user as {
          id: string;
          role: "ADMIN" | "MANAGER" | "MEMBER";
        };

        // --- Transferência para AGENTE (reusa o fluxo de assign) ---
        if (hasAgent) {
          const raw = b.assignedToId;
          let newAssigneeId: string | null;
          if (raw === null) {
            newAssigneeId = null;
          } else if (typeof raw === "string" && raw.trim() !== "") {
            newAssigneeId = raw.trim();
          } else {
            return NextResponse.json(
              { message: "assignedToId inválido." },
              { status: 400 },
            );
          }
          const prev = await prisma.conversation.findUnique({
            where: { id },
            select: {
              assignedToId: true,
              assignedTo: { select: { id: true, name: true } },
            },
          });
          const result = await assignConversationAssignedTo(id, newAssigneeId, user);
          if (!result.ok) {
            const status =
              result.code === "NOT_FOUND"
                ? 404
                : result.code === "USER_NOT_FOUND"
                  ? 400
                  : 403;
            const msg =
              result.code === "USER_NOT_FOUND"
                ? "Usuário não encontrado."
                : result.code === "NOT_FOUND"
                  ? "Conversa não encontrada."
                  : "Sem permissão para esta atribuição.";
            return NextResponse.json({ message: msg }, { status });
          }
          if (
            (prev?.assignedToId ?? null) !==
            (result.conversation.assignedToId ?? null)
          ) {
            await logDealEventsForConversationContact(id, user.id, "ASSIGNEE_CHANGED", {
              from: prev?.assignedTo ?? null,
              to: result.conversation.assignedTo ?? null,
            });
            // AWAIT (nao fire-and-forget): garante que a linha exista ANTES
            // da resposta, senao o refetch imediato do chatter perde o
            // evento (mesma corrida do resolve/reopen).
            await logEvent({
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
            // Empurra o evento pro chatter em tempo real (mesma via do
            // resolve/reopen): atualiza a timeline mesmo quando a acao veio
            // de outro agente.
            try {
              sseBus.publish("conversation_timeline_updated", {
                organizationId: (session.user as { organizationId: string | null })
                  .organizationId,
                conversationId: id,
                type: "ASSIGNEE_CHANGED",
              });
            } catch {
              /* best-effort */
            }
          }
        }

        // --- Transferência para DEPARTAMENTO (define departmentId + aciona a
        // Distribuição Inteligente escopada ao departamento) ---
        let distribution: {
          success: boolean;
          reason: string;
          selectedUserId: string | null;
          selectedUserName: string | null;
        } | null = null;
        if (hasDept) {
          const rawDept = b.departmentId;
          let newDeptId: string | null;
          if (rawDept === null) {
            newDeptId = null;
          } else if (typeof rawDept === "string" && rawDept.trim() !== "") {
            newDeptId = rawDept.trim();
          } else {
            return NextResponse.json(
              { message: "departmentId inválido." },
              { status: 400 },
            );
          }

          const prevConv = await prisma.conversation.findUnique({
            where: { id },
            select: {
              contactId: true,
              externalId: true,
              departmentId: true,
              department: { select: { id: true, name: true } },
            },
          });
          if (!prevConv) {
            return NextResponse.json(
              { message: "Conversa não encontrada." },
              { status: 404 },
            );
          }

          let newDept: { id: string; name: string } | null = null;
          if (newDeptId) {
            // findUnique é auto-escopado por organização (extension do prisma).
            newDept = await prisma.department.findUnique({
              where: { id: newDeptId },
              select: { id: true, name: true },
            });
            if (!newDept) {
              return NextResponse.json(
                { message: "Departamento não encontrado." },
                { status: 400 },
              );
            }
          }

          if ((prevConv.departmentId ?? null) !== newDeptId) {
            await prisma.conversation.update({
              where: { id },
              data: { departmentId: newDeptId },
            });
            // AWAIT (nao fire-and-forget): garante a linha antes da resposta
            // para o refetch imediato do chatter enxergar o evento.
            await logEvent({
              type: "CONVERSATION_DEPARTMENT_CHANGED",
              entityType: "CONVERSATION",
              entityId: id,
              entityLabel: prevConv.externalId ?? null,
              conversationId: id,
              contactId: prevConv.contactId ?? null,
              field: "department",
              oldValue: prevConv.department?.name ?? null,
              newValue: newDept?.name ?? null,
              meta: {
                fromDepartmentId: prevConv.departmentId ?? null,
                toDepartmentId: newDeptId,
                fromDepartmentName: prevConv.department?.name ?? null,
                toDepartmentName: newDept?.name ?? null,
              },
            });
            // Empurra o evento pro chatter em tempo real.
            try {
              sseBus.publish("conversation_timeline_updated", {
                organizationId: (session.user as { organizationId: string | null })
                  .organizationId,
                conversationId: id,
                type: "CONVERSATION_DEPARTMENT_CHANGED",
              });
            } catch {
              /* best-effort */
            }
          }

          // Aciona a Distribuição Inteligente escopada ao departamento-alvo:
          // um agente elegível do departamento recebe a conversa. Só quando há
          // departamento (transferir p/ "sem departamento" apenas desvincula).
          if (newDeptId) {
            try {
              const result = await executeDistribution({
                conversationId: id,
                contactId: prevConv.contactId ?? null,
                departmentId: newDeptId,
                triggerSource: "MANUAL",
              });
              distribution = {
                success: result.success,
                reason: result.reason,
                selectedUserId: result.selectedUserId,
                selectedUserName: result.selectedUserName,
              };
            } catch (e) {
              console.error("[transfer] falha ao acionar distribuição", e);
            }
          }
        }

        const updated = await prisma.conversation.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
            externalId: true,
            assignedToId: true,
            assignedTo: {
              select: { id: true, name: true, email: true, avatarUrl: true },
            },
            departmentId: true,
            department: {
              select: { id: true, name: true, requireTabulationOnClose: true },
            },
          },
        });

        return NextResponse.json({ conversation: updated, distribution });
      }

      const gate = await requireConversationAccess(session, id);
      if (gate) return gate;

      const conv = await getConversationById(id);
      if (!conv) {
        return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
      }

      // Modelo de ticket: action="reopen" NAO promove a conversa antiga de
      // RESOLVED->OPEN. Cria uma NOVA conversa vinculada ao mesmo
      // contato/canal, com #N+1, e retorna o novo id para o frontend
      // redirecionar. Assim cada ciclo vira um "ticket" independente com
      // timeline propria. Ver AGENT.md "ID de conversa + ticket".
      //
      // A conversa antiga JA esta RESOLVED, entao criar a nova nao colide
      // com o indice unico parcial (que so cobre status != RESOLVED).
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

        // Guard extra contra corrida: se ja existe um ticket ATIVO pro
        // contato+canal (ex.: inbound reabriu enquanto o operador clicava),
        // reusa em vez de tentar criar e violar o indice unico parcial.
        const alreadyActive = await prisma.conversation.findFirst({
          where: {
            contactId: src.contactId,
            channel: src.channel,
            status: { not: "RESOLVED" },
          },
          select: {
            id: true,
            number: true,
            status: true,
            externalId: true,
            channel: true,
            channelId: true,
            inboxName: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        const created =
          alreadyActive ??
          (await withConversationNumberRetry((number) =>
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
                createdAt: true,
                updatedAt: true,
              },
            }),
          ));

        const uid = (session.user as { id: string }).id;

        // AWAIT: o chatter da conversa antiga so ve o CONVERSATION_REOPENED
        // no refetch imediato se a linha ja existir (mesma corrida do close).
        await logEvent({
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
        try {
          sseBus.publish("conversation_timeline_updated", {
            organizationId: conv.organizationId,
            conversationId: id,
            type: "CONVERSATION_REOPENED",
          });
        } catch {
          /* best-effort */
        }
        if (!alreadyActive) {
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
        }
        await logDealEventsForConversationContact(id, uid, "CONVERSATION_REOPENED", {
          action,
          newConversationId: created.id,
          newNumber: created.number,
        });

        if (!alreadyActive) {
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
        }

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

      // Tabulacao ao encerrar. Somente aplicavel quando esta indo pra
      // RESOLVED e a conversa tem departamento vinculado. Se o
      // departamento exigir e o body nao trouxer id valido (folha na
      // arvore do dept) -> 400 (defesa; UI ja bloqueia o botao).
      let tabulationId: string | null = null;
      let tabulationAncestors: string[] = [];
      let tabulationDepartmentId: string | null = null;
      if (dbStatus === "RESOLVED") {
        const dept = await prisma.conversation.findUnique({
          where: { id },
          select: {
            departmentId: true,
            department: { select: { id: true, requireTabulationOnClose: true } },
          },
        });
        const rawTab = typeof b.tabulationId === "string" ? b.tabulationId.trim() : "";
        const requires = !!dept?.department?.requireTabulationOnClose;
        if (requires && !rawTab) {
          return NextResponse.json(
            {
              message: "Este departamento exige uma tabulacao ao encerrar.",
              code: "TABULATION_REQUIRED",
            },
            { status: 400 },
          );
        }
        if (rawTab) {
          if (!dept?.departmentId) {
            return NextResponse.json(
              { message: "Conversa sem departamento — nao aceita tabulacao." },
              { status: 400 },
            );
          }
          try {
            await assertLeafInDepartment(rawTab, dept.departmentId);
          } catch (e) {
            const code = (e as { code?: string }).code ?? "TABULATION_INVALID";
            return NextResponse.json(
              { message: (e as Error).message, code },
              { status: 400 },
            );
          }
          tabulationId = rawTab;
          tabulationDepartmentId = dept.departmentId;
          tabulationAncestors = await getAncestors(rawTab);
        }
      }

      // Configs "Manter atendente/departamento ao finalizar" (default: NÃO
      // manter → desvincula ao encerrar). Só relevante quando vai pra RESOLVED.
      let clearAssignedTo = false;
      let clearDepartment = false;
      if (dbStatus === "RESOLVED") {
        const [keepAgent, keepDepartment] = await Promise.all([
          getOrgSettingBool("conversation.keepAgentOnEnd", false),
          getOrgSettingBool("conversation.keepDepartmentOnEnd", false),
        ]);
        clearAssignedTo = !keepAgent;
        clearDepartment = !keepDepartment;
      }

      const updated = await updateConversationStatusInDb(id, dbStatus, {
        tabulationId,
        clearAssignedTo,
        clearDepartment,
      });

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
        // AWAIT (nao fire-and-forget): garante que a linha exista ANTES da
        // resposta. O chatter (ConversationTimelineTab) e' atualizado via
        // invalidacao de ["conversation-timeline", id] no onSuccess da
        // mutation; com `void` havia corrida — a resposta voltava antes do
        // insert e o refetch imediato nao encontrava o CONVERSATION_CLOSED.
        await logEvent({
          type: convEventType,
          entityType: "CONVERSATION",
          entityId: id,
          entityLabel: updated.externalId ?? null,
          conversationId: id,
          contactId: conv.contact?.id ?? null,
          field: "status",
          oldValue: conv.status,
          newValue: updated.status,
          meta: { action, ...(tabulationId ? { tabulationId } : {}) },
        });

        // Empurra o evento pro chatter em tempo real (mesma via do
        // new_message). Cobre tambem encerramentos por outro agente/automacao,
        // quando nao ha mutation local pra invalidar a query.
        try {
          sseBus.publish("conversation_timeline_updated", {
            organizationId: conv.organizationId,
            conversationId: id,
            type: convEventType,
          });
        } catch {
          /* best-effort */
        }
      }

      // Trigger de automacao conversation_tabulated (soh quando o
      // encerramento gravou tabulacao). Roda depois de logs, fire-and-forget.
      if (dbStatus === "RESOLVED" && tabulationId) {
        void logEvent({
          type: "CONVERSATION_TABULATED",
          entityType: "CONVERSATION",
          entityId: id,
          entityLabel: updated.externalId ?? null,
          conversationId: id,
          contactId: conv.contact?.id ?? null,
          meta: {
            tabulationId,
            ancestorIds: tabulationAncestors,
            departmentId: tabulationDepartmentId,
          },
        });
        // Resolve dealId (primeiro deal aberto do contato) para automacoes
        // que dependem de contexto de negocio (mover card, mudar funil).
        let dealId: string | undefined;
        if (conv.contact?.id) {
          const deal = await prisma.deal.findFirst({
            where: { contactId: conv.contact.id, status: "OPEN" },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          dealId = deal?.id;
        }
        fireTrigger("conversation_tabulated", {
          contactId: conv.contact?.id ?? undefined,
          dealId,
          data: {
            tabulationId,
            ancestorIds: tabulationAncestors,
            departmentId: tabulationDepartmentId,
            conversationId: id,
          },
        }).catch(() => {
          /* fire-and-forget */
        });
      }

      return NextResponse.json({
        conversation: {
          id: updated.id,
          status: updated.status,
          externalId: updated.externalId,
          tabulationId: updated.tabulationId,
        },
      });
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Erro ao atualizar conversa.";
      return NextResponse.json({ message: msg }, { status: 500 });
    }
  });
}
