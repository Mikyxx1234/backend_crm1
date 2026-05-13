/**
 * AI Agent Inactivity Worker — varre conversas atribuídas a agentes
 * de IA em que o cliente parou de responder por mais tempo do que
 * a config permite (`AIAgentConfig.inactivityTimerMs`). Quando o
 * limite estoura, o worker:
 *
 *   1. Envia a `inactivityFarewellMessage` (se houver).
 *   2. Executa o handoff conforme `inactivityHandoffMode`
 *      (KEEP_OWNER / SPECIFIC_USER / UNASSIGN).
 *
 * Critérios de elegibilidade (raw SQL pra ser barato):
 *   - `users.type = 'AI'`
 *   - `ai_agent_configs.active = true` e `inactivityTimerMs > 0`
 *   - `conversations.assignedToId = users.id`
 *   - `conversations.status = 'OPEN'`
 *   - `conversations.lastMessageDirection = 'out'` (agente falou por último)
 *   - `conversations.hasAgentReply = true`
 *   - `conversations.updatedAt < now() - inactivityTimerMs`
 *
 * Mesmo padrão de bootstrap do `scheduled-messages-worker`: in-process,
 * opt-out via env `AI_AGENT_INACTIVITY_WORKER=0`. Intervalo default
 * de 60s (mais barato e o timer é em minutos de qualquer forma).
 */

import { prisma } from "@/lib/prisma";
import {
  normalizeBusinessHours,
  renderTemplate,
  type HandoffMode,
} from "@/lib/ai-agents/piloting";
import {
  executeAgentHandoff,
  sendAgentMessage,
} from "@/services/ai/piloting-actions";

const INTERVAL_MS = Number(process.env.AI_AGENT_INACTIVITY_INTERVAL_MS) || 60_000;
const BATCH_SIZE = 50;

let started = false;

export function startAIAgentInactivityWorker() {
  if (started) return;
  if (process.env.AI_AGENT_INACTIVITY_WORKER === "0") {
    console.info("[ai-inactivity] worker desativado via env");
    return;
  }
  started = true;

  const tick = async () => {
    try {
      await tickOnce();
    } catch (err) {
      console.warn(
        "[ai-inactivity] tick falhou:",
        err instanceof Error ? err.message : err,
      );
    }
  };

  // Primeiro tick depois de 20s pra dar tempo do servidor subir.
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), INTERVAL_MS);
  }, 20_000);

  console.info(
    `[ai-inactivity] worker iniciado (tick=${INTERVAL_MS}ms)`,
  );
}

type ExpiredRow = {
  conversation_id: string;
  contact_id: string;
  assigned_to_id: string;
  agent_id: string;
  autonomy_mode: "AUTONOMOUS" | "DRAFT";
  inactivity_timer_ms: number;
  handoff_mode: string;
  handoff_user_id: string | null;
  farewell_message: string | null;
  business_hours: unknown;
  updated_at: Date;
};

export async function tickOnce(now: Date = new Date()) {
  // Listamos conversas cujo updatedAt é menor que (now - timer).
  // O filtro do timer específico por agente é feito no WHERE usando
  // subtração de intervalo dinâmica via make_interval.
  const rows = await prisma.$queryRaw<ExpiredRow[]>`
    SELECT
      c.id AS conversation_id,
      c."contactId" AS contact_id,
      c."assignedToId" AS assigned_to_id,
      a.id AS agent_id,
      a."autonomyMode" AS autonomy_mode,
      a."inactivityTimerMs" AS inactivity_timer_ms,
      a."inactivityHandoffMode" AS handoff_mode,
      a."inactivityHandoffUserId" AS handoff_user_id,
      a."inactivityFarewellMessage" AS farewell_message,
      a."businessHours" AS business_hours,
      c."updatedAt" AS updated_at
    FROM "conversations" c
    JOIN "users" u ON u.id = c."assignedToId"
    JOIN "ai_agent_configs" a ON a."userId" = u.id
    WHERE u.type = 'AI'
      AND a.active = true
      AND a."inactivityTimerMs" > 0
      AND c.status = 'OPEN'
      AND c."lastMessageDirection" = 'out'
      AND c."hasAgentReply" = true
      AND c."updatedAt" < (${now}::timestamptz - (a."inactivityTimerMs" || ' ms')::interval)
    ORDER BY c."updatedAt" ASC
    LIMIT ${BATCH_SIZE};
  `;

  if (rows.length === 0) return { processed: 0 };

  let handed = 0;
  for (const row of rows) {
    try {
      await dispatchOne(row);
      handed++;
    } catch (err) {
      console.error(
        `[ai-inactivity] falha processando conv=${row.conversation_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (handed > 0) {
    console.info(`[ai-inactivity] tick concluído — transferidas=${handed}`);
  }
  return { processed: rows.length, handed };
}

async function dispatchOne(row: ExpiredRow) {
  // Respeita horário de atendimento: se está fora do expediente,
  // não transfere (o humano não estaria disponível mesmo). Volta no
  // próximo tick dentro do horário.
  const businessHours = normalizeBusinessHours(row.business_hours);
  if (businessHours?.enabled) {
    const { isWithinBusinessHours } = await import("@/lib/ai-agents/piloting");
    if (!isWithinBusinessHours(businessHours)) return;
  }

  // Busca o deal aberto (se existir) — necessário pra handoff
  // KEEP_OWNER e pro evento de deal.
  const openDeal = await prisma.deal.findFirst({
    where: { contactId: row.contact_id, status: "OPEN" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, stage: { select: { name: true } } },
  });

  // Envia farewell (se configurada) antes do handoff pra cliente
  // ter contexto de que vai passar pra humano.
  if (row.farewell_message?.trim()) {
    const contact = await prisma.contact.findUnique({
      where: { id: row.contact_id },
      select: { name: true },
    });
    const text = renderTemplate(row.farewell_message, {
      contactName: contact?.name ?? null,
      dealTitle: openDeal?.title ?? null,
      stageName: openDeal?.stage?.name ?? null,
    });
    await sendAgentMessage({
      conversationId: row.conversation_id,
      contactId: row.contact_id,
      agentUserId: row.assigned_to_id,
      autonomyMode: row.autonomy_mode,
      text,
      kind: "farewell",
    }).catch((e) => {
      console.warn("[ai-inactivity] farewell falhou:", e);
    });
  }

  const mode: HandoffMode =
    row.handoff_mode === "SPECIFIC_USER" ||
    row.handoff_mode === "UNASSIGN" ||
    row.handoff_mode === "KEEP_OWNER"
      ? (row.handoff_mode as HandoffMode)
      : "KEEP_OWNER";

  await executeAgentHandoff({
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    dealId: openDeal?.id ?? null,
    agentId: row.agent_id,
    agentUserId: row.assigned_to_id,
    mode,
    specificUserId: row.handoff_user_id,
    reason: `Cliente ficou ${Math.round(row.inactivity_timer_ms / 60_000)} min sem responder — handoff automático.`,
  });
}
