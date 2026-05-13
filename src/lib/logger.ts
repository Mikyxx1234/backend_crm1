/**
 * Logger minimalista com níveis — elimina o "chuvisco" de logs
 * informativos que o operador começou a reclamar no Easypanel.
 *
 * Filosofia:
 *   - Produção (`LOG_LEVEL` não setado → default "info"): só vê eventos
 *     relevantes (novo lead, mensagem inbound, erro). Sem detalhes de
 *     payload, sem "POST recebido", sem "Status atualizado" a cada ACK.
 *   - Dev/diagnóstico (`LOG_LEVEL=debug`): destrava toda a tagarelice
 *     (phone, bsuid, contactId, traceId de cada step, etc).
 *   - Erros (`error`) sempre passam.
 *
 * Uso:
 *   import { getLogger } from "@/lib/logger";
 *   const log = getLogger("automation");
 *   log.info("Novo lead:", name);              // aparece em prod
 *   log.debug("payload completo:", payload);    // só com LOG_LEVEL=debug
 *   log.warn("sessão expirada, fallback…");
 *   log.error("DB error:", err);
 *
 * Mensagens em PORTUGUÊS por padrão — o time de ops lê isso em PT-BR.
 */

const LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LEVELS)[number];

function resolveLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (raw && (LEVELS as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  return "info";
}

const MIN_INDEX = LEVELS.indexOf(resolveLevel());

export type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export function getLogger(scope: string): Logger {
  const prefix = `[${scope}]`;
  return {
    debug: (...args) => {
      if (MIN_INDEX <= 0) console.log(prefix, ...args);
    },
    info: (...args) => {
      if (MIN_INDEX <= 1) console.log(prefix, ...args);
    },
    warn: (...args) => {
      if (MIN_INDEX <= 2) console.warn(prefix, ...args);
    },
    error: (...args) => console.error(prefix, ...args),
  };
}
