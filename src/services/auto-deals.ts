/**
 * auto-deals — Garante destino para inbounds quando o contato AINDA NÃO
 * possui histórico de deals.
 *
 * Histórico:
 *  - v1: auto-criava deal só pra contato NOVO. Contatos antigos sem deal
 *    ficavam órfãos no Painel CRM do Inbox ("Nenhum negócio aberto").
 *  - v2: passou a chamar `ensureOpenDealForContact` em TODO inbound,
 *    criando deal sempre que não houvesse OPEN — mesmo com WON/LOST no
 *    histórico. Resolveu os órfãos mas trouxe efeito colateral: cliente
 *    com deal LOST que voltasse a conversar re-disparava `deal_created`
 *    a cada mensagem, executando automações que não deveriam rodar de
 *    novo (ex.: boas-vindas pra lead já descartado).
 *  - v3 (jun/2026): "controle pelos gatilhos" — o backend NÃO reabre
 *    lead descartado nem recria deal pra cliente que já comprou. Quem
 *    decide o que fazer ao chegar uma mensagem em contato com deal
 *    fechado é a automação que o operador configurou (ex.: trigger
 *    `message_received` filtrando por `dealStatus=LOST` + step
 *    `create_deal` para reativação manual).
 *
 * Regra atual (default `reopenLostContacts: false`):
 *  - Contato sem deal algum         → cria deal + dispara `deal_created`
 *  - Contato com deal OPEN          → retorna existente, sem disparar
 *  - Contato com último deal LOST   → NÃO faz nada (skipped)
 *  - Contato com último deal WON    → NÃO faz nada (skipped)
 *
 * Opt-in `reopenLostContacts: true` mantém o comportamento v2 para
 * fluxos onde o caller PRECISA garantir um destino pros dados — ex.:
 * WhatsApp Flow Response (formulário preenchido precisa anexar campos
 * a algum deal) e scripts de backfill manual.
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
  /**
   * Opt-in pro comportamento legado (v2): cria deal sempre que não
   * houver um OPEN, mesmo que o contato tenha deals fechados (WON/LOST).
   *
   * Default `false`: respeita o histórico de deals do contato e só cria
   * automaticamente quando o contato NUNCA teve deal algum. Quem decide
   * o que fazer com um contato cujo último deal está fechado é a
   * automação configurada pelo operador (trigger `message_received` +
   * filtro `dealStatus` + step `create_deal`).
   *
   * Use `true` apenas em casos onde o caller precisa de um destino
   * garantido pros dados (ex.: WhatsApp Flow Response, scripts de
   * backfill manual).
   */
  reopenLostContacts?: boolean;
};

type EnsureOpenDealResult =
  | { status: "existing"; dealId: string }
  | { status: "created"; dealId: string }
  | {
      status: "skipped";
      reason: "no_pipeline" | "contact_has_closed_deal";
    };

/**
 * Decide se um inbound passivo merece um deal automático e, em caso
 * positivo, o cria no estágio de entrada do funil de destino disparando
 * `deal_created`.
 *
 * Resultados possíveis:
 *  - `existing`  → contato já tinha um deal OPEN; retorna o id sem efeitos.
 *  - `created`   → criou deal novo + disparou `deal_created`.
 *  - `skipped`   → não criou nada. `reason` indica o motivo:
 *      - `"no_pipeline"`              setup inicial sem funil configurado
 *      - `"contact_has_closed_deal"`  contato tem WON/LOST no histórico
 *                                     (default v3 — ver header do arquivo)
 *
 * Caller deve tratar `skipped` como no-op silencioso. Quando precisa
 * forçar criação mesmo com deals fechados, passa `reopenLostContacts: true`.
 */
export async function ensureOpenDealForContact(
  options: EnsureOpenDealOptions,
): Promise<EnsureOpenDealResult> {
  const {
    contactId,
    contactName,
    source = "auto_whatsapp",
    logTag = "auto-deals",
    channelId,
    reopenLostContacts = false,
  } = options;

  // Modo padrão (v3): só auto-cria deal pra contato SEM histórico.
  // Se o contato já teve qualquer deal (mesmo fechado), respeita o
  // estado declarado e delega a decisão pras automações configuradas
  // — evita re-disparar `deal_created` em lead descartado / cliente
  // que já comprou.
  if (!reopenLostContacts) {
    const latest = await prisma.deal.findFirst({
      where: { contactId },
      select: { id: true, status: true },
      orderBy: { createdAt: "desc" },
    });
    if (latest) {
      if (latest.status === "OPEN") {
        return { status: "existing", dealId: latest.id };
      }
      return { status: "skipped", reason: "contact_has_closed_deal" };
    }
  } else {
    // Modo legado: só reusa quando há OPEN; cria novo se tiver só WON/LOST.
    const existingOpen = await prisma.deal.findFirst({
      where: { contactId, status: "OPEN" },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (existingOpen) {
      return { status: "existing", dealId: existingOpen.id };
    }
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
      pipeline = await prisma.pipeline.findFirst({
        where: { id: channel.defaultPipelineId, archivedAt: null },
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
      where: { archivedAt: null },
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
