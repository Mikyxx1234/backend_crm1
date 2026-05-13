import { prisma } from "@/lib/prisma";
import {
  metaWhatsApp,
  type MetaPricingAnalyticsDataPoint,
} from "@/lib/meta-whatsapp/client";

/**
 * Sincroniza o cache local (`MetaPricingDailyMetric`) com o endpoint
 * `pricing_analytics` da Meta Graph API.
 *
 * - Janela: aceita qualquer intervalo. Internamente quebra em chunks
 *   de 90 dias pra respeitar o teto da Meta.
 * - Upsert por `(date, pricingType, pricingCategory, country,
 *   phoneNumber, tier)`. Se o mesmo bucket vier de novo, sobrescreve
 *   `volume` + `cost` (a Meta pode reprocessar dados recentes).
 * - Retorna stats pra logar/exibir no botao da UI.
 *
 * NAO usar dentro de loop por mensagem — bate na Graph API com
 * resposta grande (potencialmente milhares de data_points).
 */

const CHUNK_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type MetaPricingSyncResult = {
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  rangeFrom: Date;
  rangeTo: Date;
  /// Total de data_points retornados pela Meta (somando chunks).
  pointsFetched: number;
  /// Total de upserts efetivamente gravados (pode ser menor que
  /// pointsFetched se a Meta repetir o mesmo bucket).
  rowsUpserted: number;
  /// Custo total em USD no periodo (pra exibir no toast).
  totalCostUsd: number;
  /// Volume total no periodo.
  totalVolume: number;
};

/** Parse timestamp da Meta (segundos UTC) -> Date "dia 00:00 UTC". */
function bucketStartToUTCDay(unixSeconds: number): Date {
  const ms = unixSeconds * 1000;
  const d = new Date(ms);
  // Normaliza pra inicio do dia em UTC. DAILY já vem assim, mas
  // garantimos pra evitar timezone drift no PG.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Quebra [from,to] em janelas de no maximo CHUNK_DAYS dias. */
function buildChunks(from: Date, to: Date): Array<{ start: Date; end: Date }> {
  const chunks: Array<{ start: Date; end: Date }> = [];
  let cursor = new Date(from);
  const end = new Date(to);
  while (cursor < end) {
    const next = new Date(Math.min(cursor.getTime() + CHUNK_DAYS * MS_PER_DAY, end.getTime()));
    chunks.push({ start: new Date(cursor), end: new Date(next) });
    cursor = next;
  }
  return chunks;
}

export async function syncMetaPricing(input: {
  from: Date;
  to: Date;
}): Promise<MetaPricingSyncResult> {
  if (!metaWhatsApp.templatesConfigured) {
    throw new Error(
      "Meta WhatsApp nao configurado: defina META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID e META_WHATSAPP_BUSINESS_ACCOUNT_ID.",
    );
  }

  const startedAt = new Date();
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("Intervalo de datas invalido para sync de pricing analytics.");
  }
  if (from >= to) {
    throw new Error("`from` precisa ser menor que `to`.");
  }

  const chunks = buildChunks(from, to);
  let pointsFetched = 0;
  let rowsUpserted = 0;
  let totalCostUsd = 0;
  let totalVolume = 0;

  for (const chunk of chunks) {
    const startUnix = Math.floor(chunk.start.getTime() / 1000);
    const endUnix = Math.floor(chunk.end.getTime() / 1000);

    const resp = await metaWhatsApp.getPricingAnalytics({ startUnix, endUnix });
    const points: MetaPricingAnalyticsDataPoint[] =
      resp.pricing_analytics?.data_points ?? [];
    pointsFetched += points.length;

    for (const point of points) {
      const date = bucketStartToUTCDay(point.start);
      const pricingType = (point.pricing_type ?? "UNKNOWN").toUpperCase();
      const pricingCategory = (point.pricing_category ?? "UNKNOWN").toUpperCase();
      const country = (point.country ?? "UNKNOWN").toUpperCase();
      // Normaliza phone removendo '+' (assim casa com o que guardamos
      // em Conversation/Contact e mantem o unique consistente).
      const phoneNumber = (point.phone ?? "").replace(/\D/g, "");
      const tier = (point.tier ?? "").toUpperCase();
      const volume = Number(point.volume ?? 0);
      const cost = Number(point.cost ?? 0);

      await prisma.metaPricingDailyMetric.upsert({
        where: {
          date_pricingType_pricingCategory_country_phoneNumber_tier: {
            date,
            pricingType,
            pricingCategory,
            country,
            phoneNumber,
            tier,
          },
        },
        create: {
          date,
          pricingType,
          pricingCategory,
          country,
          phoneNumber,
          tier,
          volume,
          cost,
        },
        update: {
          volume,
          cost,
        },
      });

      rowsUpserted++;
      totalCostUsd += cost;
      totalVolume += volume;
    }
  }

  const finishedAt = new Date();
  return {
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    rangeFrom: from,
    rangeTo: to,
    pointsFetched,
    rowsUpserted,
    totalCostUsd,
    totalVolume,
  };
}

/**
 * Helper: retorna a data/hora do registro mais recente sincronizado
 * (pra exibir "Ultima sync: HH:mm" no header do relatorio).
 */
export async function getLastPricingSyncAt(): Promise<Date | null> {
  const last = await prisma.metaPricingDailyMetric.findFirst({
    orderBy: { syncedAt: "desc" },
    select: { syncedAt: true },
  });
  return last?.syncedAt ?? null;
}

/**
 * Helper: agrega o custo Meta (USD) e volume por categoria no
 * periodo solicitado. Usado pelo GET /api/reports/messaging.
 */
export async function aggregateMetaPricing(input: {
  from: Date;
  to: Date;
}): Promise<{
  totalCostUsd: number;
  totalVolume: number;
  byCategory: Record<string, { cost: number; volume: number }>;
  byPricingType: Record<string, { cost: number; volume: number }>;
}> {
  const rows = await prisma.metaPricingDailyMetric.findMany({
    where: {
      date: { gte: input.from, lte: input.to },
    },
    select: {
      pricingCategory: true,
      pricingType: true,
      volume: true,
      cost: true,
    },
  });

  let totalCostUsd = 0;
  let totalVolume = 0;
  const byCategory: Record<string, { cost: number; volume: number }> = {};
  const byPricingType: Record<string, { cost: number; volume: number }> = {};

  for (const r of rows) {
    totalCostUsd += r.cost;
    totalVolume += r.volume;
    const cat = r.pricingCategory || "UNKNOWN";
    const type = r.pricingType || "UNKNOWN";
    byCategory[cat] = byCategory[cat] ?? { cost: 0, volume: 0 };
    byCategory[cat].cost += r.cost;
    byCategory[cat].volume += r.volume;
    byPricingType[type] = byPricingType[type] ?? { cost: 0, volume: 0 };
    byPricingType[type].cost += r.cost;
    byPricingType[type].volume += r.volume;
  }

  return { totalCostUsd, totalVolume, byCategory, byPricingType };
}
