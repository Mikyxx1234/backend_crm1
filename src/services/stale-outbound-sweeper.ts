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

import { prisma } from "@/lib/prisma";
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
    },
    select: { id: true, conversationId: true, createdAt: true },
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

let _interval: ReturnType<typeof setInterval> | null = null;

export function startStaleOutboundSweeper(intervalMs = getIntervalMs()) {
  if (_interval) return;
  const timeoutMs = getTimeoutMs();
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
