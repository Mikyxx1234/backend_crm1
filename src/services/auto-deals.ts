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
 * TODO inbound.
 *
 * 22/jun/26 — Regra de criação ajustada para não duplicar negócios em
 * reengajamento:
 *   • Contato com deal OPEN  → reusa o existente (no-op).
 *   • Contato SEM deal OPEN mas com deal fechado (WON/LOST) → NÃO cria.
 *     O reengajamento de negócio fechado é decisão de NEGÓCIO e deve ser
 *     tratado por uma automação `message_received` (filtrada por
 *     `dealStatus` WON/LOST) que decide criar novo deal ou reabrir/mover.
 *     Se o auto-deal criasse aqui, geraria card duplicado E o gatilho
 *     `message_received` veria `dealStatus = OPEN`, impedindo a automação.
 *   • Contato SEM nenhum deal (primeiro contato) → cria e dispara
 *     `deal_created` (regra de recepção preservada para leads novos).
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
  /**
   * Canal de origem do inbound. Quando informado e o canal tiver um
   * `defaultPipelineId` válido, o deal é criado NAQUELE funil — é assim que
   * cada canal (WhatsApp, e-mail, etc.) roteia para o funil configurado.
   * Ausente ou sem funil configurado → fallback para o funil padrão da org.
   */
  channelId?: string | null;
};

type EnsureOpenDealResult =
  | { status: "existing"; dealId: string }
  | { status: "created"; dealId: string }
  | { status: "skipped"; reason: "no_pipeline" | "has_closed_deal" };

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
  const { contactId, contactName, source = "auto_whatsapp", logTag = "auto-deals", channelId } = options;

  // Fast path: contato já tem deal aberto → nada a fazer.
  const existing = await prisma.deal.findFirst({
    where: { contactId, status: "OPEN" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return { status: "existing", dealId: existing.id };
  }

  // 22/jun/26 — Reengajamento de negócio fechado NÃO cria deal novo aqui.
  // Se o contato já teve negócio (WON/LOST) e não tem nenhum OPEN, deixamos
  // o negócio fechado intacto para que uma automação `message_received`
  // (filtrada por dealStatus WON/LOST) decida no builder: criar novo deal
  // (step create_deal) ou reabrir/mover (step move_stage). Criar aqui
  // duplicaria o card e faria o gatilho `message_received` ver dealStatus
  // OPEN, neutralizando a automação de reengajamento.
  const closedDeal = await prisma.deal.findFirst({
    where: { contactId, status: { in: ["WON", "LOST"] } },
    select: { id: true },
    orderBy: { closedAt: "desc" },
  });
  if (closedDeal) {
    console.log(
      `[${logTag}] Contato ${contactName} tem negócio fechado e nenhum OPEN — não criando (reengajamento fica a cargo da automação message_received).`,
    );
    return { status: "skipped", reason: "has_closed_deal" };
  }

  // Roteamento por canal: se o inbound veio de um canal com `defaultPipelineId`
  // configurado, o lead vai pra ESSE funil. Permite que cada WhatsApp/e-mail
  // rode no seu próprio funil em vez de tudo cair no padrão da org.
  let pipeline: { id: string } | null = null;
  if (channelId) {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { defaultPipelineId: true },
    });
    if (channel?.defaultPipelineId) {
      pipeline = await prisma.pipeline.findUnique({
        where: { id: channel.defaultPipelineId },
        select: { id: true },
      });
    }
  }

  // 27/mai/26 — Fallback: prioriza pipeline marcado como `isDefault`
  // (configurado via UI de pipelines). Cai pro mais antigo só como fallback
  // quando nenhum default existe. Antes pegava sempre o mais antigo, o que
  // confundia operadores com mais de um pipeline (lead aparecia no errado).
  if (!pipeline) {
    pipeline = await prisma.pipeline.findFirst({
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true },
    });
  }
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
