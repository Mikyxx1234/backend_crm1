/**
 * auto-deals — Garante que todo contato que tem interação ativa (mensagem
 * inbound, conversa aberta) tenha pelo menos um deal OPEN vinculado ao
 * primeiro pipeline ativo.
 *
 * Originalmente, a criação automática de deal só rodava quando o contato
 * era NOVO (`resolveOrCreateContact` → `autoCreateDeal`). Isso deixava
 * contatos antigos (importados, manuais, ou vindos de um canal antes
 * da feature existir) sem deal mesmo recebendo mensagens novas —
 * resultado visível: no Inbox a sidebar "Painel CRM" mostra "Nenhum
 * negócio aberto", e no Kanban deals criados manualmente sem contato
 * deixam o workspace sem dados laterais.
 *
 * Agora o fluxo é idempotente: chamamos `ensureOpenDealForContact` em
 * TODO inbound — ele só cria deal se o contato não tiver nenhum deal
 * com `status = OPEN`. Deals fechados (WON/LOST) não bloqueiam a
 * criação: a regra é "manter pelo menos um deal OPEN pra contatos
 * ativamente conversando".
 */

import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { fireTrigger } from "@/services/automation-triggers";
import { nextDealNumber } from "@/services/deals";
import { getNextOwner } from "@/services/lead-distribution";

type EnsureOpenDealSource = "auto_whatsapp" | "auto_whatsapp_qr" | string;

type EnsureOpenDealOptions = {
  contactId: string;
  contactName: string;
  source?: EnsureOpenDealSource;
  /** Prefixo usado em logs para identificar a origem do chamador. */
  logTag?: string;
};

type EnsureOpenDealResult =
  | { status: "existing"; dealId: string }
  | { status: "created"; dealId: string }
  | { status: "skipped"; reason: "no_pipeline" };

/**
 * Garante que o contato tenha um deal OPEN. Se já existe, retorna o
 * existente. Se não existe nenhum, cria um novo no estágio de entrada
 * do primeiro pipeline e dispara o trigger `deal_created` (para que o
 * "Funil de Automações" seja acionado).
 *
 * Retorna `{ status: "skipped" }` se não há pipeline configurado (setup
 * inicial) — caller deve tratar como no-op silencioso.
 */
export async function ensureOpenDealForContact(
  options: EnsureOpenDealOptions,
): Promise<EnsureOpenDealResult> {
  const { contactId, contactName, source = "auto_whatsapp", logTag = "auto-deals" } = options;

  // Fast path: contato já tem deal aberto → nada a fazer.
  const existing = await prisma.deal.findFirst({
    where: { contactId, status: "OPEN" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return { status: "existing", dealId: existing.id };
  }

  const pipeline = await prisma.pipeline.findFirst({ orderBy: { createdAt: "asc" } });
  if (!pipeline) {
    console.warn(`[${logTag}] nenhum pipeline encontrado — deal não criado para ${contactName}`);
    return { status: "skipped", reason: "no_pipeline" };
  }

  let incomingStage = await prisma.stage.findFirst({
    where: { pipelineId: pipeline.id, isIncoming: true },
  });

  if (!incomingStage) {
    // Cria estágio "Lead de Entrada" no topo da esteira se o pipeline
    // ainda não tiver nenhum marcado como `isIncoming`. Mantém a mesma
    // semântica visual do onboarding (amarelo, SLA 7d).
    const minPos = await prisma.stage.aggregate({
      where: { pipelineId: pipeline.id },
      _min: { position: true },
    });
    const newPosition = (minPos._min.position ?? 0) - 1;

    incomingStage = await prisma.stage.create({
      data: {
        organizationId: getOrgIdOrThrow(),
        name: "Lead de Entrada",
        pipelineId: pipeline.id,
        position: newPosition,
        color: "#f59e0b",
        winProbability: 0,
        rottingDays: 7,
        isIncoming: true,
      },
    });
  }

  const maxPos = await prisma.deal.aggregate({
    where: { stageId: incomingStage.id },
    _max: { position: true },
  });

  const ownerId = await getNextOwner(pipeline.id);

  // `Deal.number` e mandatorio (sem default) e unico por org. Tenta
  // alocar max+1; em P2002 (corrida) repete ate 5x.
  let deal: { id: string } | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextDealNumber();
    try {
      deal = await prisma.deal.create({
        data: withOrgFromCtx({
          number,
          title: `Negócio - ${contactName}`,
          contactId,
          stageId: incomingStage.id,
          status: "OPEN" as const,
          position: (maxPos._max.position ?? -1) + 1,
          ownerId,
        }),
        select: { id: true },
      });
      break;
    } catch (err) {
      lastErr = err;
      const isUnique =
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002";
      if (!isUnique) throw err;
    }
  }
  if (!deal) {
    throw lastErr ?? new Error("Falha ao alocar Deal.number apos retries");
  }

  fireTrigger("deal_created", {
    dealId: deal.id,
    contactId,
    data: {
      pipelineId: pipeline.id,
      stageId: incomingStage.id,
      toStageId: incomingStage.id,
      source,
    },
  }).catch((err) =>
    console.warn(`[${logTag}] fireTrigger deal_created error:`, err),
  );

  console.log(`[${logTag}] Deal criado em "${incomingStage.name}" para ${contactName}`);
  return { status: "created", dealId: deal.id };
}
