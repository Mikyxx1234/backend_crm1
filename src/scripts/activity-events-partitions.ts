/**
 * activity-events-partitions
 *
 * Manutenção das partições mensais de `activity_events` (Fase 1 DW):
 *   1. Garante a partição do mês atual e do próximo (antecedência — evita
 *      que inserts caiam na partição DEFAULT por falta de partição).
 *   2. Aplica retenção: dropa partições anteriores ao corte (default 24
 *      meses; DROP de partição é metadata-only, instantâneo).
 *
 * Uso:
 *   pnpm tsx src/scripts/activity-events-partitions.ts
 *   pnpm tsx src/scripts/activity-events-partitions.ts --retention=36
 *   pnpm tsx src/scripts/activity-events-partitions.ts --no-retention
 *
 * Cron sugerido (rodar 1x/dia ou 1x/mês):
 *   0 3 1 * *  →  cria partição do próximo mês + retenção
 *
 * IMPORTANTE: carrega `.env.local` ANTES de importar Prisma (mesmo motivo
 * dos demais scripts — prismaBase instancia PrismaClient no top-level).
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

function parseRetention(): number | null {
  if (process.argv.includes("--no-retention")) return null;
  const arg = process.argv.find((a) => a.startsWith("--retention="));
  if (arg) {
    const n = Number.parseInt(arg.split("=")[1] ?? "", 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 24; // default: 24 meses quentes
}

async function main() {
  const retentionMonths = parseRetention();
  const { prismaBase } = await import("@/lib/prisma-base");

  // 1) Garante partição do mês atual e do próximo.
  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  for (const d of [thisMonth, nextMonth]) {
    const iso = d.toISOString().slice(0, 10);
    await prismaBase.$executeRawUnsafe(
      `SELECT logs_ensure_activity_events_partition('${iso}'::date)`,
    );
    console.log(`[partitions] partição garantida para ${iso.slice(0, 7)}`);
  }

  // 2) Retenção.
  if (retentionMonths != null) {
    const rows = await prismaBase.$queryRawUnsafe<{ dropped: number }[]>(
      `SELECT logs_drop_old_activity_events_partitions(${retentionMonths}) AS dropped`,
    );
    const dropped = Number(rows?.[0]?.dropped ?? 0);
    console.log(
      `[partitions] retenção ${retentionMonths}m aplicada — ${dropped} partição(ões) removida(s)`,
    );
  } else {
    console.log("[partitions] retenção desabilitada (--no-retention)");
  }

  await prismaBase.$disconnect();
  console.log("[partitions] concluído");
}

main().catch((e) => {
  console.error("[partitions] erro:", e);
  process.exit(1);
});
