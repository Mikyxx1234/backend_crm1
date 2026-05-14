/**
 * Agregacao de usage para queries da UI/admin (PR 6.3).
 *
 * Funcoes pura-leitura sobre `usage_records`. Nao toca em Stripe (isso
 * fica em `aggregator.ts` / `scripts/billing-sync.ts`).
 *
 * Usa `analyticsClient()` (read replica) quando disponivel — agregacoes
 * sao queries pesadas SUM/MAX e podem rodar fora do primary.
 */
import { analyticsClient } from "@/lib/analytics";
import { prismaBase } from "@/lib/prisma-base";
import type { MeterKey } from "./meters";
import { METERS } from "./meters";

export interface UsagePeriod {
  /** Inicio inclusivo. */
  start: Date;
  /** Fim exclusivo. */
  end: Date;
}

/**
 * Retorna uso agregado de uma org por meter no periodo.
 * Aplica `aggregation` declarado em meters.ts (sum/max/last).
 */
export async function getUsageByMeter(
  organizationId: string,
  period: UsagePeriod,
): Promise<Record<MeterKey, bigint>> {
  const client = (await safeAnalyticsClient()) ?? prismaBase;
  const rows = await client.usageRecord.findMany({
    where: {
      organizationId,
      occurredAt: { gte: period.start, lt: period.end },
    },
    select: { meter: true, amount: true, occurredAt: true },
  });

  const ZERO = BigInt(0);
  const out = {} as Record<MeterKey, bigint>;
  for (const k of Object.keys(METERS) as MeterKey[]) out[k] = ZERO;

  for (const row of rows) {
    const def = METERS[row.meter as MeterKey] as
      | (typeof METERS)[MeterKey]
      | undefined;
    if (!def) continue;
    const meter = def.key as MeterKey;
    const current = out[meter] ?? ZERO;
    // Aggregation "last" (snapshot diario, nao usado ainda — meters.ts:
    // MeterAggregation reserva a entrada) cai no comportamento default
    // (sum) ate ser implementado em script de snapshot proprio.
    const aggregation: string = def.aggregation;
    if (aggregation === "max") {
      out[meter] = current === ZERO || row.amount > current ? row.amount : current;
    } else {
      out[meter] = current + row.amount;
    }
  }

  return out;
}

/**
 * Versao "current period" baseada na subscription da org.
 * Periodo padrao = `currentPeriodStart` ate `currentPeriodEnd` (Stripe);
 * se ausente, usa primeiro dia do mes ate primeiro dia do mes seguinte.
 */
export async function getCurrentPeriodUsage(
  organizationId: string,
): Promise<Record<MeterKey, bigint>> {
  const sub = await prismaBase.organizationSubscription.findUnique({
    where: { organizationId },
    select: { currentPeriodStart: true, currentPeriodEnd: true },
  });

  const now = new Date();
  const start =
    sub?.currentPeriodStart ??
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end =
    sub?.currentPeriodEnd ??
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return getUsageByMeter(organizationId, { start, end });
}

async function safeAnalyticsClient(): Promise<typeof prismaBase | null> {
  try {
    const c = analyticsClient();
    return c as unknown as typeof prismaBase;
  } catch {
    return null;
  }
}
