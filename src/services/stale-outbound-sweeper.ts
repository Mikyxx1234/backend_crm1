/**
 * Sweeper de mensagens outbound "stale".
 *
 * Contexto: a Meta WhatsApp Cloud API aceita mensagens com 200 OK
 * (retornando `messages[].id`) mesmo quando, silenciosamente, não vai
 * entregá-las — casos típicos são número WhatsApp Business pausado,
 * rate-limit silencioso, quality rating baixo/flagged, ou o próprio
 * número do cliente num estado que a Meta não consegue rotear. Nessas
 * condições NÃO chega nenhum webhook de status (nem `delivered` nem
 * `failed`), e a mensagem fica eternamente com `sendStatus = "sent"`
 * no CRM enganando o operador com o check ✓.
 *
 * Esse sweeper roda periodicamente, localiza mensagens outbound que
 * estão em `sent` há mais tempo do que o razoável (default 30 min,
 * configurável via `STALE_OUTBOUND_TIMEOUT_MS`) e as marca como
 * `failed` com um `sendError` explícito. Também liga `hasError` na
 * conversa e publica SSE para que a UI reflita em tempo real.
 *
 * A janela grande (30 min) evita falsos positivos — normalmente a
 * Meta entrega em segundos, no máximo alguns minutos mesmo quando
 * o destinatário está offline.
 */

// Sweeper roda cross-tenant (varre mensagens "sent" stale de TODAS as
// orgs). Usa prismaBase (sem org-scope) porque o worker nao tem
// RequestContext e nao deve filtrar por organization — a seguranca ja
// esta garantida pelo filtro de `direction=out` + `sendStatus=sent`.
import { prismaBase as prisma } from "@/lib/prisma-base";
import { getLogger } from "@/lib/logger";
import { sseBus } from "@/lib/sse-bus";
import { refreshWhatsAppHealth } from "@/services/whatsapp-health";

const log = getLogger("stale-outbound-sweeper");

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;
const DEFAULT_INTERVAL_MS = 30 * 1_000;
const BATCH_SIZE = 100;

// Mensagem explícita de TIMEOUT INTERNO — não é um erro retornado pela
// Meta. A Cloud API aceitou (200 OK + wamid) mas nunca emitiu nenhum
// webhook `sent`/`delivered`/`failed` dentro da janela do sweeper.
// Prefixamos "Timeout:" pra que o operador diferencie de falhas com
// código real (formato `... (code 131047)`) que vêm via webhook.
// Cenários conhecidos que caem aqui:
//  - número WhatsApp Business pausado / flagged / RESTRICTED
//  - quality rating rebaixado (throttle silencioso)
//  - drop silencioso da Meta sem status=failed
//  - problema de roteamento no lado do destinatário
const STALE_ERROR_MESSAGE =
  "Timeout: a Meta não confirmou entrega (nenhum webhook recebido). O número WhatsApp Business pode estar pausado, flagged ou com qualidade rebaixada. Verifique o status do canal.";

// Tipos de mensagem que NÃO passam pela Cloud API da Meta — são
// eventos/artefatos gerados pelo próprio CRM (gravação de chamada feita
// no browser do agente, evento de terminate da call, nota interna,
// rascunho de IA). Elas recebem `externalId` interno (ex.:
// `call_timeline:{callId}`) que não é wamid, e nunca terão webhook de
// delivery. Incluí-las no sweep as marcava incorretamente como
// "Timeout" depois de 15 min.
const INTERNAL_MESSAGE_TYPES = [
  "whatsapp_call",
  "whatsapp_call_recording",
  "note",
  "ai_draft",
];

export async function sweepStaleOutbound(
  timeoutMs = getTimeoutMs(),
): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMs);

  const stale = await prisma.message.findMany({
    where: {
      direction: "out",
      sendStatus: "sent",
      createdAt: { lt: cutoff },
      // Só consideramos mensagens que passaram pela Meta (têm wamid).
      // Uma nota interna sem externalId é legítimamente "sent" e não
      // deve ser marcada como falha.
      externalId: { not: null },
      // Exclui tipos internos (gravação de chamada, evento de call,
      // nota, rascunho de IA) que não são enviados pela Cloud API.
      messageType: { notIn: INTERNAL_MESSAGE_TYPES },
      // Mensagens privadas (notas internas) também ficam de fora
      // mesmo que por algum motivo tenham recebido externalId.
      isPrivate: false,
    },
    select: { id: true, conversationId: true, createdAt: true, organizationId: true },
    take: BATCH_SIZE,
  });

  if (stale.length === 0) return 0;

  let processed = 0;
  for (const msg of stale) {
    try {
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          sendStatus: "failed",
          sendError: STALE_ERROR_MESSAGE,
        },
      });

      await prisma.conversation
        .update({
          where: { id: msg.conversationId },
          data: { hasError: true },
        })
        .catch(() => {});

      try {
        sseBus.publish("message_status", {
          organizationId: msg.organizationId,
          conversationId: msg.conversationId,
          messageId: msg.id,
          status: "failed",
          error: STALE_ERROR_MESSAGE,
        });
      } catch {
        // SSE é best-effort, falha aqui não pode atrapalhar o sweep.
      }

      processed++;
    } catch (err) {
      log.warn(`Falha ao marcar mensagem ${msg.id} como stale:`, err);
    }
  }

  if (processed > 0) {
    log.warn(
      `${processed} mensagem(ns) marcada(s) como falhas por ausência de confirmação da Meta.`,
    );
    // Quando aparece mensagem stale é indício forte de que o número
    // Meta está com algum problema. Força revalidação do healthcheck
    // pra que o banner global apareça no próximo refetch do dashboard
    // sem esperar o TTL de 2 min.
    refreshWhatsAppHealth();
  }

  return processed;
}

function getTimeoutMs(): number {
  const raw = process.env.STALE_OUTBOUND_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function getIntervalMs(): number {
  const raw = process.env.STALE_OUTBOUND_SWEEP_INTERVAL_MS;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_MS;
}

/**
 * Auto-healing one-shot: corrige mensagens internas (gravação de
 * chamada, evento de call, notas, rascunho de IA) que foram
 * erroneamente marcadas como `failed` pelo sweeper antes do fix que
 * adicionou o filtro `messageType notIn INTERNAL_MESSAGE_TYPES`.
 *
 * Roda no boot uma única vez. Idempotente — só toca linhas com o
 * `sendError` exato do sweeper.
 */
export async function healWronglyFailedInternalMessages(): Promise<number> {
  try {
    const result = await prisma.message.updateMany({
      where: {
        sendStatus: "failed",
        sendError: STALE_ERROR_MESSAGE,
        messageType: { in: INTERNAL_MESSAGE_TYPES },
      },
      data: {
        sendStatus: "delivered",
        sendError: null,
      },
    });
    if (result.count > 0) {
      log.info(
        `Auto-healing: ${result.count} mensagem(ns) interna(s) marcada(s) indevidamente como stale foram restauradas.`,
      );
    }
    return result.count;
  } catch (err) {
    log.warn("Falha no auto-healing de mensagens internas:", err);
    return 0;
  }
}

let _interval: ReturnType<typeof setInterval> | null = null;

export function startStaleOutboundSweeper(intervalMs = getIntervalMs()) {
  if (_interval) return;
  const timeoutMs = getTimeoutMs();
  // One-shot no boot: corrige vítimas do filtro antigo (mensagens
  // `whatsapp_call_recording` marcadas como falha mesmo sem terem
  // passado pela Meta). Não bloqueia o start do sweeper.
  healWronglyFailedInternalMessages().catch(() => {});
  _interval = setInterval(() => {
    sweepStaleOutbound(timeoutMs).catch((err) =>
      log.error("Falha no sweeper de mensagens stale:", err),
    );
  }, intervalMs);
  if (typeof _interval === "object" && "unref" in _interval) {
    (_interval as NodeJS.Timeout).unref();
  }
  log.info(
    `Sweeper iniciado (a cada ${Math.round(intervalMs / 1000)}s, marca "sent" > ${Math.round(timeoutMs / 60_000)}min como falha).`,
  );
}

export function stopStaleOutboundSweeper() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
