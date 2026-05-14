/**
 * Helper para queries de analytics (PR 5.2).
 *
 * Encapsula a escolha entre primary e read-replica para queries
 * READ-ONLY pesadas. Use sempre que estiver fazendo:
 *   - dashboards (counts, aggregates por periodo)
 *   - relatorios (drill-down, group by)
 *   - listagens analiticas que toleram <2s de lag
 *
 * NAO use para:
 *   - leituras transacionais (deve ver write recente do mesmo
 *     request) — use `prisma`.
 *   - writes de qualquer tipo — replica e read-only.
 *   - leituras hot que precisam ser cache (ver `lib/cache`).
 *
 * @example
 *   import { analyticsClient } from "@/lib/analytics";
 *
 *   const totals = await analyticsClient().conversation.count({
 *     where: { createdAt: { gte: from } },
 *   });
 *
 * @see docs/read-replica.md
 */
import { prismaReplica } from "@/lib/prisma-replica";

export function analyticsClient() {
  return prismaReplica;
}
