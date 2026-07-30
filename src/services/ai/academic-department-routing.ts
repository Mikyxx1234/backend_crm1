/**
 * Resolve Department por nome amigável (Acolhimento / Retenção / Atendimento),
 * com match flexível no banco (ex.: "Atendimento - SAC").
 */

import { executeDistribution } from "@/services/distribution";
import { prisma } from "@/lib/prisma";
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

  return "atendimento";
}

export async function resolveDepartmentByName(
  name: string,
): Promise<{ id: string; name: string } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const exact = await prisma.department.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (exact) return exact;

  const key =
    classifyAcademicDepartmentKey(trimmed) ??
    (normalize(trimmed).includes("acolh")
      ? "acolhimento"
      : normalize(trimmed).includes("reten")
        ? "retencao"
        : normalize(trimmed).includes("atend")
          ? "atendimento"
          : null);

  const all = await prisma.department.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (key) {
    const patterns = ACADEMIC_DEPARTMENT_ALIASES[key];
    const hit = all.find((d) => {
      const dn = normalize(d.name);
      return patterns.some((p) => dn.includes(normalize(p)));
    });
    if (hit) return hit;
  }

  // Fallback: contains do texto pedido
  const needle = normalize(trimmed);
  return all.find((d) => normalize(d.name).includes(needle)) ?? null;
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
        aiGreetedAt: null,
        updatedAt: new Date(),
      },
    });
  } else {
    await prisma.conversation.update({
      where: { id: args.conversationId },
      data: {
        assignedToId: null,
        aiGreetedAt: null,
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

  return {
    departmentId: dept?.id ?? null,
    departmentName: dept?.name ?? null,
    distribution,
  };
}
