/**
 * Meters canonicos pra usage tracking + metered billing (PR 6.3).
 *
 * Cada meter representa uma dimensao de consumo cobravel ou monitoravel
 * por organizacao. Adicionar um meter novo:
 *   1. Acrescentar a entry abaixo (com `unit`, `description`, `aggregation`).
 *   2. Incluir no plano (src/lib/billing/plans.ts) com limite por tier.
 *   3. Adicionar `recordUsage()` no call-site que produz o consumo.
 *   4. Documentar em docs/billing.md.
 *
 * Convencoes:
 *   - `key` em snake_case, plural quando aplicavel.
 *   - `unit` curto pra UI ("msg", "tokens", "GB").
 *   - `aggregation`:
 *       - "sum"  → soma todos os eventos no periodo (mensagens, tokens).
 *       - "max"  → pico no periodo (storage_bytes — bytes em uso).
 *       - "last" → ultimo valor reportado (contacts_active — snapshot
 *                  diario fica em max do dia).
 */

export type MeterAggregation = "sum" | "max" | "last";

interface MeterDefRaw {
  readonly key: string;
  readonly unit: string;
  readonly description: string;
  readonly aggregation: MeterAggregation;
  readonly stripeMetered: boolean;
}

export const METERS = {
  messages_sent: {
    key: "messages_sent",
    unit: "msg",
    description: "Mensagens enviadas (todas as direcoes outbound em qualquer canal).",
    aggregation: "sum",
    /** Stripe metered: cada evento envia delta. */
    stripeMetered: true,
  },
  ai_tokens: {
    key: "ai_tokens",
    unit: "tokens",
    description: "Tokens consumidos pelo agente IA (input + output, todos os modelos).",
    aggregation: "sum",
    stripeMetered: true,
  },
  contacts_active: {
    key: "contacts_active",
    unit: "contacts",
    description:
      "Contatos com >= 1 mensagem trocada nos ultimos 30d. Snapshot diario reportado como `set` (max do dia).",
    aggregation: "max",
    stripeMetered: true,
  },
  storage_bytes: {
    key: "storage_bytes",
    unit: "bytes",
    description: "Bytes em storage (uploads, anexos, knowledge docs).",
    aggregation: "max",
    /** Storage cobra por tier (limite hard) e nao metered — apenas display. */
    stripeMetered: false,
  },
  campaign_recipients: {
    key: "campaign_recipients",
    unit: "msg",
    description: "Destinatarios alcancados em campanhas (subset de messages_sent).",
    aggregation: "sum",
    stripeMetered: false,
  },
  whatsapp_call_minutes: {
    key: "whatsapp_call_minutes",
    unit: "min",
    description:
      "Minutos de chamada WhatsApp gravados (PR feature flag whatsapp_call_recording).",
    aggregation: "sum",
    stripeMetered: true,
  },
} as const satisfies Record<string, MeterDefRaw>;

export type MeterKey = keyof typeof METERS;
export type MeterDef = (typeof METERS)[MeterKey];

/** Lista todos os meters como array (uso em iteracao de UI/aggregator). */
export function listMeters(): MeterDef[] {
  return Object.values(METERS);
}

/** Meters Stripe-metered (sao reportados como Subscription Item Usage Record). */
export function listStripeMeteredMeters(): MeterDef[] {
  return Object.values(METERS).filter((m) => m.stripeMetered);
}
