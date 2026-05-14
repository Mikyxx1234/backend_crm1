/**
 * Agregador de usage → Stripe metered (PR 6.3).
 *
 * Roda periodicamente (cron diario sugerido). Pra cada org com
 * subscription Stripe ativa:
 *   1. Busca rows de `usage_records` com `reportedAt = NULL`.
 *   2. Agrega por meter (sum, max conforme a definicao em meters.ts).
 *   3. Envia ao Stripe via `reportUsage()` com idempotency key estavel.
 *   4. Marca rows como reportedAt=NOW() em batch.
 *
 * Idempotency key:
 *   `<orgId>:<meter>:<periodStartISO>` — se o cron rodar 2x no mesmo
 *   periodo, Stripe rejeita o segundo (ou aceita silentemente, depende
 *   do action='set' vs 'increment'). Usamos `set` pra meters
 *   pico-baseados (storage_bytes, contacts_active) — sempre representa
 *   o estado atual. `increment` pra meters cumulativos (messages_sent,
 *   ai_tokens) — soma o delta.
 *
 * Erro handling:
 *   - Falha em uma org NAO bloqueia as outras (try/catch por iteracao).
 *   - Falha na chamada Stripe → row fica reportedAt=NULL, retry no
 *     proximo cron.
 *
 * @see scripts/billing-sync.ts (entry CLI)
 * @see docs/billing.md
 */
import { prismaBase } from "@/lib/prisma-base";
import { getLogger } from "@/lib/logger";
import { METERS, type MeterKey } from "./meters";
import { getStripeAdapter } from "./stripe";

const logger = getLogger("billing.aggregator");

interface RunResult {
  organizationsProcessed: number;
  recordsReported: number;
  errors: number;
}

export async function runUsageAggregation(opts?: {
  /** Limite de orgs por execucao (paginacao). 0 = todas. */
  maxOrgs?: number;
  /** Dry-run: nao chama Stripe nem marca reported. */
  dryRun?: boolean;
}): Promise<RunResult> {
  const result: RunResult = {
    organizationsProcessed: 0,
    recordsReported: 0,
    errors: 0,
  };

  const stripe = await getStripeAdapter();
  if (!stripe.enabled && !opts?.dryRun) {
    logger.info(
      "[billing/aggregator] Stripe desabilitado (sem chave) — skipping (use dryRun pra testar logica)",
    );
    return result;
  }

  const subs = await prismaBase.organizationSubscription.findMany({
    where: {
      stripeSubscriptionId: { not: null },
      status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
    },
    select: {
      organizationId: true,
      stripeSubscriptionId: true,
      currentPeriodStart: true,
    },
    take: opts?.maxOrgs && opts.maxOrgs > 0 ? opts.maxOrgs : undefined,
  });

  for (const sub of subs) {
    try {
      const reported = await aggregateForOrg({
        organizationId: sub.organizationId,
        stripeSubscriptionId: sub.stripeSubscriptionId!,
        periodStart: sub.currentPeriodStart ?? new Date(),
        dryRun: !!opts?.dryRun,
      });
      result.recordsReported += reported;
      result.organizationsProcessed++;
    } catch (err) {
      result.errors++;
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          organizationId: sub.organizationId,
        },
        "[billing/aggregator] falha em org",
      );
    }
  }

  logger.info(result, "[billing/aggregator] run finished");
  return result;
}

async function aggregateForOrg(args: {
  organizationId: string;
  stripeSubscriptionId: string;
  periodStart: Date;
  dryRun: boolean;
}): Promise<number> {
  const { organizationId, stripeSubscriptionId, periodStart, dryRun } = args;

  const stripe = await getStripeAdapter();
  const subscription = await stripe.retrieveSubscription(stripeSubscriptionId);
  if (!subscription) return 0;

  // Busca rows nao-reportadas
  const pending = await prismaBase.usageRecord.findMany({
    where: {
      organizationId,
      reportedAt: null,
    },
    select: { id: true, meter: true, amount: true },
  });
  if (pending.length === 0) return 0;

  const ZERO = BigInt(0);
  const byMeter = new Map<MeterKey, { sum: bigint; max: bigint; ids: string[] }>();
  for (const row of pending) {
    const def = METERS[row.meter as MeterKey];
    if (!def || !def.stripeMetered) continue;
    const cur = byMeter.get(def.key as MeterKey) ?? {
      sum: ZERO,
      max: ZERO,
      ids: [],
    };
    cur.sum += row.amount;
    if (row.amount > cur.max) cur.max = row.amount;
    cur.ids.push(row.id);
    byMeter.set(def.key as MeterKey, cur);
  }

  let reportedCount = 0;
  const periodIso = periodStart.toISOString();

  for (const [meter, agg] of byMeter.entries()) {
    const def = METERS[meter];
    const subItemId = subscription.meteredItems[meter];
    if (!subItemId) {
      logger.warn(
        { meter, organizationId },
        "[billing/aggregator] subscription nao tem item para meter — skipping",
      );
      continue;
    }

    // Meters max/last sao stateful (snapshot atual) → action='set'.
    // Meters sum sao cumulativos → action='increment'. Cast para
    // string evita narrow excessivo do `as const` em meters.ts.
    const aggregation: string = def.aggregation;
    const isStateful = aggregation === "max" || aggregation === "last";
    const action: "increment" | "set" = isStateful ? "set" : "increment";
    const quantity = action === "set" ? Number(agg.max) : Number(agg.sum);
    if (quantity <= 0) continue;

    const idempotencyKey = `${organizationId}:${meter}:${periodIso}:${action}`;

    if (!dryRun) {
      await stripe.reportUsage({
        subscriptionItemId: subItemId,
        quantity,
        timestamp: Math.floor(Date.now() / 1000),
        action,
        idempotencyKey,
      });

      // Marca rows como reported em batch
      await prismaBase.usageRecord.updateMany({
        where: { id: { in: agg.ids } },
        data: {
          reportedAt: new Date(),
          reportIdempKey: idempotencyKey,
        },
      });
    }

    reportedCount += agg.ids.length;
  }

  return reportedCount;
}
