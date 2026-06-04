/**
 * Healthcheck ativo do número WhatsApp Business (Meta Cloud API).
 *
 * Problema que resolve: a Cloud API aceita envios com 200 OK e devolve
 * wamid mesmo quando o número está pausado/FLAGGED/RESTRICTED ou com
 * `quality_rating` RED/YELLOW. Nesse estado a mensagem NUNCA é entregue
 * e nenhum webhook de `failed` chega — o CRM só descobre via sweep de
 * mensagens stale, o que leva minutos. Com esse healthcheck a gente
 * detecta o estado ruim ANTES do envio e avisa o operador globalmente.
 *
 * Estratégia: cache em memória com TTL curto (2 min por default,
 * configurável via env). Qualquer request ao endpoint `/api/whatsapp/health`
 * retorna o cache; se expirou, faz GET ao Graph e refresca. Custo para
 * a Meta é desprezível (1 request a cada 2 min). Também expomos
 * `refreshWhatsAppHealth()` para sobrescrever o cache depois de um
 * envio ter falhado sincrônico (ex: 131047) ou após um status failed
 * chegar por webhook — assim o banner fica consistente sem esperar
 * o TTL.
 */

import {
  metaWhatsApp,
  type MetaPhoneNumberHealth,
} from "@/lib/meta-whatsapp/client";
import { getLogger } from "@/lib/logger";

const log = getLogger("whatsapp-health");

export type WhatsAppHealthSeverity = "ok" | "warning" | "critical" | "unknown";

export type WhatsAppHealthStatus = {
  /** true se conseguimos falar com a Meta nesta última leitura. */
  reachable: boolean;
  severity: WhatsAppHealthSeverity;
  /** Mensagem curta já localizada em PT-BR, pronta pra banner. */
  message: string;
  /** Lista de motivos individuais (ex: quality rating, status, tier). */
  reasons: string[];
  /** Snapshot bruto devolvido pela Meta (sanitizado, sem token/PII). */
  raw?: MetaPhoneNumberHealth | null;
  /** Se a integração está configurada no .env ou DB. */
  configured: boolean;
  /** Última consulta feita com sucesso. */
  checkedAt: string | null;
  /** Mensagem de erro quando `reachable=false`. */
  error?: string | null;
};

const DEFAULT_TTL_MS = 2 * 60 * 1_000;

let cached: WhatsAppHealthStatus | null = null;
let cachedAt = 0;
let inflight: Promise<WhatsAppHealthStatus> | null = null;

function ttlMs(): number {
  const raw = process.env.WHATSAPP_HEALTH_TTL_MS;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

function buildStatus(raw: MetaPhoneNumberHealth): WhatsAppHealthStatus {
  const reasons: string[] = [];
  let severity: WhatsAppHealthSeverity = "ok";

  const quality = (raw.quality_rating ?? "").toUpperCase();
  if (quality === "RED") {
    reasons.push("Qualidade do número marcada como VERMELHA — entregas podem ser bloqueadas pela Meta.");
    severity = "critical";
  } else if (quality === "YELLOW") {
    reasons.push("Qualidade do número está AMARELA — risco elevado de rebaixamento e bloqueio.");
    if (severity === "ok") severity = "warning";
  }

  const connStatus = (raw.status ?? "").toUpperCase();
  if (connStatus === "FLAGGED") {
    reasons.push("Número está FLAGGED pela Meta — entregas podem ser descartadas silenciosamente.");
    severity = "critical";
  } else if (connStatus === "RESTRICTED") {
    reasons.push("Número está RESTRICTED — limite de destinatários único atingido no período.");
    severity = "critical";
  } else if (connStatus === "PENDING") {
    reasons.push("Número em PENDING — aprovação da Meta ainda em curso.");
    if (severity === "ok") severity = "warning";
  } else if (connStatus === "DISCONNECTED") {
    reasons.push("Número DESCONECTADO no WhatsApp Cloud.");
    severity = "critical";
  }

  const nameStatus = (raw.name_status ?? "").toUpperCase();
  if (nameStatus === "DECLINED") {
    reasons.push("Nome verificado DECLINED — cadastro do display name rejeitado.");
    if (severity !== "critical") severity = "warning";
  } else if (nameStatus === "EXPIRED") {
    reasons.push("Nome verificado EXPIRED — renove o display name.");
    if (severity !== "critical") severity = "warning";
  } else if (nameStatus === "PENDING_REVIEW") {
    reasons.push("Nome verificado em análise pela Meta.");
  }

  const mode = (raw.account_mode ?? "").toUpperCase();
  if (mode === "SANDBOX") {
    reasons.push("Conta em modo SANDBOX — só envia para números de teste cadastrados.");
    if (severity === "ok") severity = "warning";
  }

  const message = severity === "ok"
    ? `Número ${raw.display_phone_number ?? raw.id ?? ""} operando normalmente.`
    : reasons[0] ?? "Número WhatsApp com problemas — verifique o painel da Meta.";

  return {
    reachable: true,
    severity,
    message,
    reasons,
    raw,
    configured: metaWhatsApp.configured,
    checkedAt: new Date().toISOString(),
    error: null,
  };
}

async function fetchFresh(): Promise<WhatsAppHealthStatus> {
  if (!metaWhatsApp.configured) {
    return {
      reachable: false,
      severity: "unknown",
      message: "Integração Meta WhatsApp não configurada.",
      reasons: [],
      configured: false,
      checkedAt: null,
      raw: null,
      error: null,
    };
  }
  try {
    const raw = await metaWhatsApp.getPhoneNumberHealth();
    const status = buildStatus(raw);
    if (status.severity === "critical") {
      log.warn(`Saúde do número WhatsApp CRÍTICA: ${status.reasons.join(" | ")}`);
    } else if (status.severity === "warning") {
      log.info(`Saúde do número WhatsApp em AVISO: ${status.reasons.join(" | ")}`);
    }
    return status;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.warn(`Falha ao consultar saúde do número WhatsApp: ${errMsg}`);
    return {
      reachable: false,
      severity: "unknown",
      message: "Não foi possível consultar o status do número na Meta.",
      reasons: [errMsg],
      configured: true,
      checkedAt: null,
      raw: null,
      error: errMsg,
    };
  }
}

export async function getWhatsAppHealth(options?: { force?: boolean }): Promise<WhatsAppHealthStatus> {
  const force = options?.force === true;
  const now = Date.now();
  if (!force && cached && now - cachedAt < ttlMs()) {
    return cached;
  }
  if (inflight) return inflight;
  inflight = fetchFresh()
    .then((status) => {
      cached = status;
      cachedAt = Date.now();
      return status;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Invalida o cache e agenda um refresh imediato em background. Chamado
 * quando detectamos erro síncrono num envio (ex: 131047, 470) ou quando
 * um webhook de `failed` chega — assim o banner aparece pro operador
 * sem esperar o próximo TTL.
 */
export function refreshWhatsAppHealth(): void {
  cached = null;
  cachedAt = 0;
  void getWhatsAppHealth({ force: true }).catch(() => {});
}

export function getCachedWhatsAppHealth(): WhatsAppHealthStatus | null {
  return cached;
}
