/**
 * Planos comerciais (PR 6.3).
 *
 * Lista canonica dos tiers oferecidos. Cada plano define:
 *   - `key` slug usado em DB (`OrganizationSubscription.planKey`).
 *   - `name` exibido em UI/Stripe.
 *   - `priceUsd` mensal (apenas indicativo — preco real fica no Stripe).
 *   - `limits` por meter — soft limit (warn) ou hard limit (block).
 *   - `stripePriceId` opcional, populado via env por ambiente.
 *
 * Estrategia:
 *   - Free e starter: hard limit em messages_sent / ai_tokens.
 *   - Pro: soft limit (avisa) e cobra overage via metered.
 *   - Enterprise: limite negociado individualmente (`limitsOverride` na subscription).
 *
 * Em produc: priceIds vem de env (`STRIPE_PRICE_<TIER>_<METER>`) — nunca
 * hardcode. Em dev/CI rodam todos com priceId=null (sem chamada Stripe).
 */
import type { MeterKey } from "./meters";

export type PlanLimits = Partial<Record<MeterKey, number>>;

export interface PlanDef {
  key: string;
  name: string;
  /** Preco base em USD por mes — display only. */
  priceUsd: number;
  /** Limites do plano (em unidade base do meter). null = ilimitado. */
  limits: PlanLimits;
  /** Limites soft (avisa antes de atingir). null = sem warn. */
  softLimits?: PlanLimits;
  /** Stripe price ids por meter. Populados via env. null = sem cobranca metered. */
  stripePriceIds?: Partial<Record<MeterKey, string | null>>;
  /** Stripe price id base do plano (recurring monthly). */
  stripeBasePriceId?: string | null;
}

function envPriceId(tier: string, meter: string): string | null {
  return (
    process.env[`STRIPE_PRICE_${tier.toUpperCase()}_${meter.toUpperCase()}`] ??
    null
  );
}

export const PLANS: Record<string, PlanDef> = {
  free: {
    key: "free",
    name: "Free",
    priceUsd: 0,
    limits: {
      messages_sent: 1000,
      ai_tokens: 50_000,
      contacts_active: 100,
      storage_bytes: 1_073_741_824, // 1 GB
    },
    stripeBasePriceId: null,
  },
  starter: {
    key: "starter",
    name: "Starter",
    priceUsd: 49,
    limits: {
      messages_sent: 10_000,
      ai_tokens: 500_000,
      contacts_active: 1_000,
      storage_bytes: 10_737_418_240, // 10 GB
    },
    softLimits: {
      messages_sent: 8_000,
      ai_tokens: 400_000,
    },
    stripeBasePriceId: process.env.STRIPE_PRICE_STARTER_BASE ?? null,
    stripePriceIds: {
      messages_sent: envPriceId("starter", "messages_sent"),
      ai_tokens: envPriceId("starter", "ai_tokens"),
    },
  },
  pro: {
    key: "pro",
    name: "Pro",
    priceUsd: 199,
    limits: {
      messages_sent: 100_000,
      ai_tokens: 5_000_000,
      contacts_active: 10_000,
      storage_bytes: 107_374_182_400, // 100 GB
    },
    softLimits: {
      messages_sent: 80_000,
      ai_tokens: 4_000_000,
    },
    stripeBasePriceId: process.env.STRIPE_PRICE_PRO_BASE ?? null,
    stripePriceIds: {
      messages_sent: envPriceId("pro", "messages_sent"),
      ai_tokens: envPriceId("pro", "ai_tokens"),
      whatsapp_call_minutes: envPriceId("pro", "whatsapp_call_minutes"),
    },
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    /// Custom — fechado contrato, negociar limites + priceIds.
    priceUsd: 0,
    limits: {},
    stripeBasePriceId: null,
  },
};

export function getPlan(key: string): PlanDef {
  return PLANS[key] ?? PLANS.free;
}

/** Retorna limite efetivo (override > plan default). null = ilimitado. */
export function getEffectiveLimit(
  planKey: string,
  meter: MeterKey,
  override?: PlanLimits | null,
): number | null {
  if (override && meter in override) return override[meter] ?? null;
  const plan = getPlan(planKey);
  return plan.limits[meter] ?? null;
}
