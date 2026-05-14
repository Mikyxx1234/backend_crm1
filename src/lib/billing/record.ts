/**
 * Append-only usage tracking (PR 6.3).
 *
 * `recordUsage()` e o ponto de entrada UNICO pra registrar consumo.
 * Sempre `try { ... } catch { swallow }` — billing nunca pode quebrar
 * o request. Se DB cair, perdemos a row (audit log do erro), mas o
 * fluxo do user segue.
 *
 * Performance: insercao e fire-and-forget (Promise descartada). A
 * Prisma extension scope ja escolhe DB writeable. Nao ha read-modify-write.
 *
 * Idempotencia opcional via `sourceId` — se o caller passar um id estavel
 * (ex.: messageId, runId), retries de webhook nao geram duplicatas. NAO
 * aplicamos UNIQUE no DB pra evitar custo em hot path; idempotencia e
 * por convencao (o aggregator deduplica por (orgId, meter, sourceId)).
 *
 * Fluxo:
 *   1. App-side: `recordUsage({ meter, amount, ... })`.
 *   2. Insere row em `usage_records` com reportedAt=null.
 *   3. Cron `scripts/billing-sync.ts` agrega rows nao-reportadas e
 *      envia ao Stripe via metered usage record.
 *   4. Marca rows como `reportedAt=NOW()`.
 *
 * @see docs/billing.md
 */
import { prismaBase } from "@/lib/prisma-base";
import { getLogger } from "@/lib/logger";
import type { MeterKey } from "./meters";
import { METERS } from "./meters";

const logger = getLogger("billing.record");

export interface RecordUsageInput {
  /** Org dona do consumo. Use `getOrgIdOrThrow()` no caller. */
  organizationId: string;
  /** Chave do meter (lista canonica em meters.ts). */
  meter: MeterKey;
  /** Quantidade consumida no evento (>= 0). */
  amount: number | bigint;
  /** Quando aconteceu — default `now()`. */
  occurredAt?: Date;
  /** Id opcional pra idempotencia (ex.: message.id). */
  sourceId?: string | null;
  /** Metadata livre (ex.: channel, modelo IA). */
  metadata?: Record<string, unknown> | null;
}

/**
 * Insere uma row em `usage_records`. Fire-and-forget — exceptions sao
 * absorvidas e logadas. **Nunca** await direto se for caminho critico
 * (mensagem enviando) — use o helper `recordUsageAsync` que retorna
 * void imediatamente.
 *
 * Validacao:
 *   - amount >= 0 (negativo seria refund — nao suportado neste momento).
 *   - meter conhecido (lista canonica). Meter desconhecido = warning.
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const amountBig = typeof input.amount === "bigint"
    ? input.amount
    : BigInt(Math.round(input.amount));

  if (amountBig < BigInt(0)) {
    logger.warn(
      { meter: input.meter, amount: input.amount.toString() },
      "[billing/record] amount negativo ignorado",
    );
    return;
  }

  if (amountBig === BigInt(0)) return; // no-op silencioso

  if (!(input.meter in METERS)) {
    logger.warn(
      { meter: input.meter },
      "[billing/record] meter desconhecido — ignorado",
    );
    return;
  }

  try {
    await prismaBase.usageRecord.create({
      data: {
        organizationId: input.organizationId,
        meter: input.meter,
        amount: amountBig,
        occurredAt: input.occurredAt ?? new Date(),
        sourceId: input.sourceId ?? null,
        metadata: (input.metadata ?? null) as never,
      },
    });
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        meter: input.meter,
        organizationId: input.organizationId,
      },
      "[billing/record] falha ao gravar usage_record",
    );
  }
}

/**
 * Wrapper fire-and-forget: dispara `recordUsage` mas nao bloqueia o caller.
 * Use no hot path de envio de mensagem / inferencia IA.
 *
 *     recordUsageAsync({ organizationId, meter: "messages_sent", amount: 1 });
 *     // continua imediatamente
 */
export function recordUsageAsync(input: RecordUsageInput): void {
  void recordUsage(input);
}
