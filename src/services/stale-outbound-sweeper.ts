/**
 * Sweeper de mensagens outbound "stale" — comportamento de timeout→failed
 * DESATIVADO.
 *
 * Histórico: a Meta pode aceitar o envio (200 + wamid) sem nunca emitir
 * webhook de status; o sweeper marcava `sent` antigo como `failed` com
 * sendError de timeout e ligava `hasError` na conversa.
 *
 * Decisão de produto: NÃO marcar timeout como erro. A mensagem permanece
 * `sent` (1 ✓ na UI) até um webhook real (`delivered` / `read` / `failed`).
 *
 * O módulo continua existindo para:
 *  - export estável (`startStaleOutboundSweeper` ainda é chamado no boot);
 *  - one-shot de auto-heal de tipos internos marcados indevidamente no passado.
 */

// Usa prismaBase (sem org-scope): o worker não tem RequestContext.
import { prismaBase as prisma } from "@/lib/prisma-base";
import { getLogger } from "@/lib/logger";

const log = getLogger("stale-outbound-sweeper");

// Texto legado do sendError de timeout — só usado pelo auto-heal abaixo
// (mensagens internas que o sweeper antigo marcou por engano).
const STALE_ERROR_MESSAGE =
  "Timeout: a Meta não confirmou entrega (nenhum webhook de status recebido no CRM). Verifique se o callback do webhook está acessível na internet e se os eventos estão sendo processados. Se o número estiver ok no Manager, o cliente pode ter recebido a mensagem mesmo assim.";

const INTERNAL_MESSAGE_TYPES = [
  "whatsapp_call",
  "whatsapp_call_recording",
  "note",
  "ai_draft",
];

/**
 * No-op: não marca mais outbound stale como `failed`.
 * Mantido o export para callers/testes existentes.
 */
export async function sweepStaleOutbound(
  _timeoutMs?: number,
): Promise<number> {
  return 0;
}

/**
 * Auto-healing one-shot: corrige mensagens internas (gravação de
 * chamada, evento de call, notas, rascunho de IA) que foram
 * erroneamente marcadas como `failed` pelo sweeper antes do filtro
 * `messageType notIn INTERNAL_MESSAGE_TYPES`.
 *
 * Roda no boot uma única vez. Idempotente — só toca linhas com o
 * `sendError` exato do sweeper legado.
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

let _started = false;

export function startStaleOutboundSweeper(_intervalMs?: number) {
  if (_started) return;
  _started = true;
  // One-shot legado; não inicia intervalo — timeout não vira failed.
  healWronglyFailedInternalMessages().catch(() => {});
  log.info(
    "Sweeper de stale-outbound desativado (mensagens `sent` sem webhook da Meta permanecem `sent`).",
  );
}

export function stopStaleOutboundSweeper() {
  _started = false;
}
