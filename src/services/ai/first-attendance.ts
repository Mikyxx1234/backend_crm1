/**
 * Primeiro atendimento por Agente IA (pipe acadêmico).
 *
 * Regras:
 *  - Só no funil acadêmico (nome ~ACADEM*, pipelineId do agente, ou
 *    org setting `ai.firstAttendancePipelineIds`).
 *  - Sem responsável humano → IA assume conversa + contato + deals OPEN.
 *  - Com responsável humano já atribuído → devolve o chat a esse humano
 *    (não “rouba” nem deixa na IA).
 *  - Desliga com `ai.firstAttendanceEnabled=false`.
 */

import { getOrgSetting } from "@/lib/org-settings";
import { prisma } from "@/lib/prisma";
import { isContactAllowedForAi } from "@/services/ai/phone-allowlist";

function logAi(event: string, payload: Record<string, unknown>) {
  console.info(
    "[ai-attend]",
    JSON.stringify({ event, ts: new Date().toISOString(), ...payload }),
  );
}

async function isFirstAttendanceEnabled(): Promise<boolean> {
  try {
    const raw = await getOrgSetting("ai.firstAttendanceEnabled");
    if (raw == null || raw === "") return true;
    return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
  } catch {
    return true;
  }
}

async function resolveFirstAttendanceAgent(): Promise<{
  userId: string;
  pipelineId: string | null;
} | null> {
  try {
    const forced = await getOrgSetting("ai.firstAttendanceUserId");
    if (forced?.trim()) {
      const u = await prisma.user.findFirst({
        where: {
          id: forced.trim(),
          type: "AI",
          aiAgentConfig: { active: true, autonomyMode: "AUTONOMOUS" },
        },
        select: {
          id: true,
          aiAgentConfig: { select: { pipelineId: true } },
        },
      });
      if (u) {
        return {
          userId: u.id,
          pipelineId: u.aiAgentConfig?.pipelineId ?? null,
        };
      }
    }
  } catch {
    /* fora de RequestContext */
  }

  const preferred = await prisma.aIAgentConfig.findFirst({
    where: {
      active: true,
      autonomyMode: "AUTONOMOUS",
      archetype: "ATENDIMENTO",
    },
    orderBy: { createdAt: "asc" },
    select: { userId: true, pipelineId: true },
  });
  if (preferred) {
    return { userId: preferred.userId, pipelineId: preferred.pipelineId };
  }

  const any = await prisma.aIAgentConfig.findFirst({
    where: { active: true, autonomyMode: "AUTONOMOUS" },
    orderBy: { createdAt: "asc" },
    select: { userId: true, pipelineId: true },
  });
  if (!any) return null;
  return { userId: any.userId, pipelineId: any.pipelineId };
}

async function resolveConfiguredPipelineIds(
  agentPipelineId: string | null,
): Promise<string[]> {
  const ids = new Set<string>();
  if (agentPipelineId) ids.add(agentPipelineId);
  try {
    const raw = await getOrgSetting("ai.firstAttendancePipelineIds");
    if (raw?.trim()) {
      for (const part of raw.split(/[,;\s]+/)) {
        const id = part.trim();
        if (id) ids.add(id);
      }
    }
  } catch {
    /* ignore */
  }
  return [...ids];
}

/**
 * Contato está no pipe acadêmico se tem deal OPEN cujo pipeline:
 *  - está na lista configurada (agente / org setting), OU
 *  - nome contém "academ" (ex.: ACADEMICO).
 */
async function isAcademicPipeContact(
  contactId: string,
  agentPipelineId: string | null,
): Promise<boolean> {
  const configured = await resolveConfiguredPipelineIds(agentPipelineId);
  const openDeals = await prisma.deal.findMany({
    where: { contactId, status: "OPEN" },
    select: {
      id: true,
      pipelineId: true,
      pipeline: { select: { name: true } },
    },
  });
  if (openDeals.length === 0) {
    // Sem deal: ainda assim atende se o canal default aponta p/ acadêmico
    // (mensagens iniciais antes do deal). Heurística pelo nome do pipeline
    // default do canal da conversa mais recente.
    const conv = await prisma.conversation.findFirst({
      where: { contactId, status: { not: "RESOLVED" } },
      orderBy: { updatedAt: "desc" },
      select: {
        channelRef: {
          select: {
            defaultPipeline: { select: { id: true, name: true } },
          },
        },
      },
    });
    const pipe = conv?.channelRef?.defaultPipeline;
    if (!pipe) return false;
    if (configured.includes(pipe.id)) return true;
    return /academ/i.test(pipe.name ?? "");
  }

  for (const d of openDeals) {
    if (configured.includes(d.pipelineId)) return true;
    if (/academ/i.test(d.pipeline?.name ?? "")) return true;
  }
  return false;
}

/**
 * Dono humano atual (contato ou deal OPEN) — se existir, o chat volta pra ele.
 */
async function findExistingHumanOwner(
  contactId: string,
): Promise<string | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      assignedToId: true,
      assignedTo: { select: { type: true } },
    },
  });
  if (contact?.assignedToId && contact.assignedTo?.type === "HUMAN") {
    return contact.assignedToId;
  }

  const deal = await prisma.deal.findFirst({
    where: {
      contactId,
      status: "OPEN",
      ownerId: { not: null },
      owner: { type: "HUMAN" },
    },
    orderBy: { updatedAt: "desc" },
    select: { ownerId: true },
  });
  return deal?.ownerId ?? null;
}

async function assignConversationToHuman(args: {
  conversationId: string;
  contactId: string;
  humanUserId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: args.conversationId },
      data: { assignedToId: args.humanUserId },
    });
    await tx.contact.update({
      where: { id: args.contactId },
      data: { assignedToId: args.humanUserId },
    });
    await tx.deal.updateMany({
      where: { contactId: args.contactId, status: "OPEN" },
      data: { ownerId: args.humanUserId },
    });
  });
}

/**
 * Se a conversa está sem assignee humano e está no pipe acadêmico,
 * atribui ao agente de 1º atendimento.
 * Contatos na allowlist de teste: força IA (ignora herança de responsável
 * e heurística de pipe) enquanto ninguém humano respondeu nesta conversa.
 * @returns userId da IA se atribuiu; null se não aplicável.
 */
export async function tryAssignFirstAttendanceAi(args: {
  conversationId: string;
  contactId: string;
  assignedToId?: string | null;
}): Promise<string | null> {
  if (!(await isFirstAttendanceEnabled())) {
    logAi("first_attendance_disabled", {
      conversationId: args.conversationId,
    });
    return null;
  }

  // Segurança: não atribui IA a nenhum telefone fora da allowlist.
  let onAllowlist = false;
  try {
    onAllowlist = await isContactAllowedForAi(args.contactId);
    if (!onAllowlist) {
      logAi("first_attendance_skip_allowlist", {
        conversationId: args.conversationId,
        contactId: args.contactId,
      });
      return null;
    }
  } catch (e) {
    console.error("[ai] first_attendance allowlist failed — skipping", e);
    return null;
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: args.conversationId },
    select: {
      assignedToId: true,
      contactId: true,
      hasHumanReply: true,
      assignedTo: { select: { type: true } },
    },
  });
  if (!conv) return null;

  const contactId = conv.contactId ?? args.contactId;
  if (!contactId) return null;

  // Já está na IA → ok.
  if (conv.assignedToId && conv.assignedTo?.type === "AI") {
    return conv.assignedToId;
  }

  // Humano já respondeu nesta conversa → não rouba.
  if (conv.hasHumanReply && conv.assignedTo?.type === "HUMAN") {
    logAi("first_attendance_skip_human_replied", {
      conversationId: args.conversationId,
      humanUserId: conv.assignedToId,
    });
    return null;
  }

  // Allowlist de teste: força 1º atendimento IA (não herda Joyce/etc.).
  if (onAllowlist && !conv.hasHumanReply) {
    const agent = await resolveFirstAttendanceAgent();
    if (!agent) {
      logAi("first_attendance_no_agent", {
        conversationId: args.conversationId,
      });
      return null;
    }
    const aiUserId = agent.userId;
    await prisma.$transaction(async (tx) => {
      await tx.conversation.update({
        where: { id: args.conversationId },
        data: { assignedToId: aiUserId, aiGreetedAt: null },
      });
      await tx.contact.update({
        where: { id: contactId },
        data: { assignedToId: aiUserId },
      });
      await tx.deal.updateMany({
        where: { contactId, status: "OPEN" },
        data: { ownerId: aiUserId },
      });
    });
    logAi("first_attendance_assigned_allowlist", {
      conversationId: args.conversationId,
      contactId,
      aiUserId,
    });
    return aiUserId;
  }

  // Já tem humano no chat → não mexe.
  if (conv.assignedToId && conv.assignedTo?.type === "HUMAN") {
    logAi("first_attendance_skip_human_on_chat", {
      conversationId: args.conversationId,
      humanUserId: conv.assignedToId,
    });
    return null;
  }

  // Humano no contato/deal → devolve o chat a ele (mesmo se chat estava na IA).
  const humanOwner =
    (args.assignedToId
      ? (
          await prisma.user.findUnique({
            where: { id: args.assignedToId },
            select: { type: true },
          })
        )?.type === "HUMAN"
        ? args.assignedToId
        : null
      : null) ?? (await findExistingHumanOwner(contactId));

  if (humanOwner) {
    if (conv.assignedToId !== humanOwner) {
      await assignConversationToHuman({
        conversationId: args.conversationId,
        contactId,
        humanUserId: humanOwner,
      });
      logAi("first_attendance_restored_human", {
        conversationId: args.conversationId,
        contactId,
        humanUserId: humanOwner,
      });
    }
    return null;
  }

  const agent = await resolveFirstAttendanceAgent();
  if (!agent) {
    logAi("first_attendance_no_agent", {
      conversationId: args.conversationId,
    });
    return null;
  }

  const academic = await isAcademicPipeContact(contactId, agent.pipelineId);
  if (!academic) {
    logAi("first_attendance_skip_not_academic", {
      conversationId: args.conversationId,
      contactId,
    });
    return null;
  }

  const aiUserId = agent.userId;

  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: args.conversationId },
      data: {
        assignedToId: aiUserId,
        aiGreetedAt: null,
      },
    });
    await tx.contact.update({
      where: { id: contactId },
      data: { assignedToId: aiUserId },
    });
    await tx.deal.updateMany({
      where: { contactId, status: "OPEN" },
      data: { ownerId: aiUserId },
    });
  });

  logAi("first_attendance_assigned", {
    conversationId: args.conversationId,
    contactId,
    aiUserId,
  });
  return aiUserId;
}

/**
 * Garante 1º atendimento IA em toda mensagem inbound (não só na criação
 * do ticket). Chamar ANTES de fireTrigger/salesbot para silenciar INICIO-PIPE.
 */
export async function ensureInboundAiAttendance(args: {
  conversationId: string;
  contactId: string;
}): Promise<string | null> {
  try {
    return await tryAssignFirstAttendanceAi({
      conversationId: args.conversationId,
      contactId: args.contactId,
      assignedToId: null,
    });
  } catch (e) {
    console.error("[ai] ensureInboundAiAttendance failed", e);
    return null;
  }
}
