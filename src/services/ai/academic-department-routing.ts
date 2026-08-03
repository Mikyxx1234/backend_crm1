/**
 * Resolve Department por nome amigável (Acolhimento / Retenção / Atendimento),
 * com match flexível no banco (ex.: "Atendimento - SAC").
 */

import { executeDistribution } from "@/services/distribution";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { ACADEMIC_DEPARTMENT_ALIASES } from "@/lib/ai-agents/academic-atendimento-prompt";

export type AcademicDeptKey = keyof typeof ACADEMIC_DEPARTMENT_ALIASES;

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/** Classifica texto livre / alias em chave canônica. */
export function classifyAcademicDepartmentKey(
  raw: string,
): AcademicDeptKey | null {
  const n = normalize(raw);
  if (!n) return null;
  if (n.includes("acolh")) return "acolhimento";
  if (n.includes("reten")) return "retencao";
  if (n.includes("atend") || n.includes("sac")) return "atendimento";
  return null;
}

/**
 * Inferência de departamento a partir da mensagem do aluno + funil atual.
 * Usado no handoff automático (baixa confiança) e como hint nas tools.
 */
export function inferDepartmentFromContext(args: {
  userMessage?: string | null;
  pipelineName?: string | null;
  stageName?: string | null;
}): AcademicDeptKey {
  const msg = normalize(args.userMessage ?? "");
  if (
    /cancel|tranc|desist/.test(msg) ||
    /transferenc\w*\s+(de\s+)?(curso|polo)/.test(msg) ||
    /mudar\s+(de\s+)?(curso|polo)/.test(msg) ||
    /trocar\s+(de\s+)?(curso|polo)/.test(msg)
  ) {
    return "retencao";
  }

  const funnel = normalize(
    `${args.pipelineName ?? ""} ${args.stageName ?? ""}`,
  );
  if (funnel.includes("acolh")) return "acolhimento";

  // Início de aulas / calouros / novo ingresso → Acolhimento.
  if (
    /inici[oa]\s*(d[ae]s?\s+)?aulas?/.test(msg) ||
    /comec[oa]\s*(d[ae]s?\s+)?aulas?/.test(msg) ||
    /quando\s+(comec|inic)/.test(msg) ||
    /calouro/.test(msg) ||
    /novo\s+ingresso/.test(msg) ||
    /matricula\s+recente/.test(msg)
  ) {
    return "acolhimento";
  }

  return "atendimento";
}

export async function resolveDepartmentByName(
  name: string,
): Promise<{ id: string; name: string } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const { getOrgIdOrThrow } = await import("@/lib/request-context");
  const orgId = getOrgIdOrThrow();

  const key =
    classifyAcademicDepartmentKey(trimmed) ??
    (normalize(trimmed).includes("acolh")
      ? "acolhimento"
      : normalize(trimmed).includes("reten")
        ? "retencao"
        : normalize(trimmed).includes("atend")
          ? "atendimento"
          : null);

  // SEMPRE escopado à org do contexto — evita pegar "Atendimento" de
  // outra organização (bug cross-tenant EduIT → Cruzeiro).
  const all = await prisma.department.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      _count: {
        select: { members: { where: { user: { type: "HUMAN" } } } },
      },
    },
    orderBy: { name: "asc" },
  });

  const score = (d: (typeof all)[number]) => {
    const dn = normalize(d.name);
    let s = (d._count.members ?? 0) * 10;
    // Prefere "Atendimento - SAC" a um "Atendimento" genérico.
    if (key === "atendimento" && dn.includes("sac")) s += 100;
    if (key === "atendimento" && dn === "atendimento") s -= 20;
    return s;
  };
  const ranked = [...all].sort((a, b) => score(b) - score(a));

  const exact = ranked.find(
    (d) => normalize(d.name) === normalize(trimmed),
  );
  if (exact) return { id: exact.id, name: exact.name };

  if (key) {
    const patterns = ACADEMIC_DEPARTMENT_ALIASES[key];
    const hit = ranked.find((d) => {
      const dn = normalize(d.name);
      return patterns.some((p) => dn.includes(normalize(p)));
    });
    if (hit) return { id: hit.id, name: hit.name };
  }

  const needle = normalize(trimmed);
  const contains = ranked.find((d) => normalize(d.name).includes(needle));
  return contains ? { id: contains.id, name: contains.name } : null;
}

export async function resolveDepartmentByKey(
  key: AcademicDeptKey,
): Promise<{ id: string; name: string } | null> {
  const labels: Record<AcademicDeptKey, string> = {
    acolhimento: "Acolhimento",
    retencao: "Retenção",
    atendimento: "Atendimento",
  };
  return resolveDepartmentByName(labels[key]);
}

/**
 * Após atribuir consultor humano, o negócio vai para o estágio
 * "Em Atendimento" do funil ATENDIMENTO (Kanban operacional).
 */
export async function moveOpenDealToEmAtendimento(args: {
  dealId?: string | null;
  contactId?: string | null;
}): Promise<{ moved: boolean; stageId?: string; dealId?: string }> {
  let dealId = args.dealId ?? null;
  if (!dealId && args.contactId) {
    const open = await prisma.deal.findFirst({
      where: { contactId: args.contactId, status: "OPEN" },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    dealId = open?.id ?? null;
  }
  if (!dealId) return { moved: false };

  const preferred = await prisma.stage.findFirst({
    where: {
      name: { equals: "Em Atendimento", mode: "insensitive" },
      pipeline: { name: { equals: "ATENDIMENTO", mode: "insensitive" } },
    },
    select: { id: true },
  });
  const stage =
    preferred ??
    (await prisma.stage.findFirst({
      where: { name: { equals: "Em Atendimento", mode: "insensitive" } },
      select: { id: true },
      orderBy: { position: "asc" },
    }));
  if (!stage) return { moved: false, dealId };

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { stageId: true },
  });
  if (!deal) return { moved: false, dealId };
  if (deal.stageId === stage.id) {
    return { moved: true, stageId: stage.id, dealId };
  }

  try {
    const { moveDeal } = await import("@/services/deals");
    await moveDeal(dealId, stage.id, 0);
    return { moved: true, stageId: stage.id, dealId };
  } catch (e) {
    console.error("[academic-handoff] moveOpenDealToEmAtendimento failed", e);
    return { moved: false, stageId: stage.id, dealId };
  }
}

/**
 * Dúvida comercial sobre valor/grade/info de curso (em geral outro curso
 * que não o da matrícula) — NUNCA site institucional; sempre humano.
 */
export function isCourseShoppingInquiry(userMessage: string): boolean {
  const msg = normalize(userMessage);
  if (!msg) return false;
  if (
    /(valor|preco|mensalidade|investimento|quanto\s+custa).{0,50}(curso|graduacao|pos[\s-]?graduacao|mba)/.test(
      msg,
    ) ||
    /(curso|graduacao|pos[\s-]?graduacao|mba).{0,50}(valor|preco|mensalidade|investimento|quanto\s+custa)/.test(
      msg,
    )
  ) {
    return true;
  }
  if (
    /grade\s+curricular|matriz\s+curricular|disciplinas\s+(do|de)\s+curso|grade\s+do\s+curso/.test(
      msg,
    )
  ) {
    return true;
  }
  if (
    /quais\s+cursos|cursos\s+disponiveis|quero\s+saber\s+(do|sobre)\s+(o\s+)?curso|informac(ao|oes)\s+(do|sobre)\s+(o\s+)?curso|outro\s+curso/.test(
      msg,
    )
  ) {
    return true;
  }
  if (
    /cruzeiro\.(edu|com)|portal\.cruzeiro|site\s+(da\s+)?cruzeiro|www\.cruzeiro/.test(
      msg,
    )
  ) {
    return true;
  }
  return false;
}

/** Texto do agente implica handoff (mesmo sem tool). */
export function textImpliesAcademicHandoff(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return (
    t.includes("vou te conectar") ||
    t.includes("vou conectar voce") ||
    t.includes("conectar com um") ||
    t.includes("conectar com uma") ||
    t.includes("consultor(a) fala") ||
    t.includes("consultor fala com voce") ||
    t.includes("consultora fala com voce") ||
    t.includes("setor de retenc") ||
    t.includes("ja esta na fila")
  );
}

/**
 * Handoff acadêmico: define departamento + Distribuição Inteligente.
 * Substitui o “só limpar assignee” do transfer_to_human genérico.
 */
export async function executeAcademicDepartmentHandoff(args: {
  conversationId: string;
  contactId: string | null;
  dealId?: string | null;
  userMessage?: string | null;
  /** Se informado, tem prioridade sobre a inferência. */
  departmentName?: string | null;
  reason?: string;
}): Promise<{
  departmentId: string | null;
  departmentName: string | null;
  distribution: Awaited<ReturnType<typeof executeDistribution>> | null;
}> {
  try {
    const { ensureAcademicDepartmentRoster } = await import(
      "@/services/ai/ensure-academic-dept-roster"
    );
    await ensureAcademicDepartmentRoster({ force: true });
  } catch {
    /* ignore */
  }

  let pipelineName: string | null = null;
  let stageName: string | null = null;
  if (args.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id: args.dealId },
      select: {
        stage: {
          select: {
            name: true,
            pipeline: { select: { name: true } },
          },
        },
      },
    });
    stageName = deal?.stage?.name ?? null;
    pipelineName = deal?.stage?.pipeline?.name ?? null;
  } else if (args.contactId) {
    const deal = await prisma.deal.findFirst({
      where: { contactId: args.contactId, status: "OPEN" },
      orderBy: { updatedAt: "desc" },
      select: {
        stage: {
          select: {
            name: true,
            pipeline: { select: { name: true } },
          },
        },
      },
    });
    stageName = deal?.stage?.name ?? null;
    pipelineName = deal?.stage?.pipeline?.name ?? null;
  }

  let dept: { id: string; name: string } | null = null;
  if (args.departmentName?.trim()) {
    dept = await resolveDepartmentByName(args.departmentName);
  }

  let userMessage = args.userMessage ?? null;
  if (!userMessage && args.conversationId) {
    const lastIn = await prisma.message.findFirst({
      where: {
        conversationId: args.conversationId,
        direction: "in",
        isPrivate: false,
      },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    userMessage = lastIn?.content ?? null;
  }

  // Antes de re-inferir pelo texto do aluno, respeita o departamento que
  // já foi fixado na conversa (ex.: via transfer_to_department).
  if (!dept) {
    const convRow = await prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { departmentId: true },
    });
    if (convRow?.departmentId) {
      dept = await prisma.department.findUnique({
        where: { id: convRow.departmentId },
        select: { id: true, name: true },
      });
    }
  }

  if (!dept) {
    const key = inferDepartmentFromContext({
      userMessage,
      pipelineName,
      stageName,
    });
    dept = await resolveDepartmentByKey(key);
  }

  if (dept) {
    await prisma.conversation.update({
      where: { id: args.conversationId },
      data: {
        departmentId: dept.id,
        assignedToId: null,
        // Mantém aiGreetedAt: se zerar, o próximo inbound reassumido
        // pela IA reenvia a openingMessage (bug Thabata).
        updatedAt: new Date(),
      },
    });
  } else {
    await prisma.conversation.update({
      where: { id: args.conversationId },
      data: {
        assignedToId: null,
        updatedAt: new Date(),
      },
    });
  }

  // Garante contactId para enfileirar em DistributionPending se ninguém
  // elegível (queueLimit / offline / dept) — senão a aba mostra a conversa
  // mas sem origem "Agente IA".
  let contactId = args.contactId;
  if (!contactId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { contactId: true },
    });
    contactId = conv?.contactId ?? null;
  }

  // AI_AGENT: se ninguém elegível (offline / fila cheia / fora do dept),
  // o motor enfileira em DistributionPending e a conversa fica sem
  // assignedToId → aparece em "Aguardando distribuição".
  const distribution = await executeDistribution({
    dealId: args.dealId ?? null,
    contactId,
    conversationId: args.conversationId,
    triggerSource: "AI_AGENT",
    departmentId: dept?.id ?? null,
    reassign: true,
  });

  // Nota interna de distribuição (privada, não duplica em 2 min)
  const noteContent = dept
    ? `Conversa distribuída para ${dept.name}`
    : `Conversa distribuída para a fila de atendimento`;
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  const existingNote = await prisma.message.findFirst({
    where: {
      conversationId: args.conversationId,
      messageType: "note",
      isPrivate: true,
      content: { startsWith: "Conversa distribuída para" },
      createdAt: { gte: twoMinutesAgo },
    },
    select: { id: true },
  });
  if (!existingNote) {
    await prisma.message
      .create({
        data: withOrgFromCtx({
          conversationId: args.conversationId,
          content: noteContent,
          messageType: "note",
          isPrivate: true,
          authorType: "bot",
          direction: "out",
          senderName: "Agente IA",
          sendStatus: "sent",
        }),
      })
      .catch(() => null);
  }

  // Consultor humano atribuído → funil operacional "Em Atendimento".
  if (distribution?.success && distribution.selectedUserId) {
    const assignee = await prisma.user.findUnique({
      where: { id: distribution.selectedUserId },
      select: { type: true },
    });
    if (assignee?.type === "HUMAN") {
      await moveOpenDealToEmAtendimento({
        dealId: args.dealId ?? null,
        contactId,
      }).catch(() => null);
    }
  }

  return {
    departmentId: dept?.id ?? null,
    departmentName: dept?.name ?? null,
    distribution,
  };
}
