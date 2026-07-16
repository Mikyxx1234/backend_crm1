/**
 * Snapshot do pool pg exposto via `@prisma/adapter-pg`.
 *
 * O adapter guarda um `pg.Pool` internamente. Nao ha API publica para
 * inspecionar contadores; entao usamos duck typing seguro: se conseguirmos
 * chegar num objeto com `totalCount/idleCount/waitingCount` (contrato do
 * pacote `pg`), reportamos. Caso contrario, no-op.
 *
 * Uma fonte alternativa e mais robusta em prod e o `postgres-exporter`
 * (queries em pg_stat_activity), ja incluido no stack de monitoramento.
 * Este gauge cobre a perspectiva do proprio processo — util para detectar
 * saturacao antes do banco.
 */

import { metrics } from "@/lib/metrics";

type PgLikePool = {
  totalCount?: number;
  idleCount?: number;
  waitingCount?: number;
};

const globalForDbPool = globalThis as unknown as {
  __dbPoolRef?: PgLikePool | null;
};

/**
 * Registra o pool pg para coleta. Chame uma vez no bootstrap se voce tem
 * acesso ao Pool (ex: onde o adapter e instanciado). Ausente por padrao —
 * `collectDbPool()` vira no-op.
 */
export function registerDbPool(pool: PgLikePool): void {
  globalForDbPool.__dbPoolRef = pool;
}

export async function collectDbPool(): Promise<void> {
  const pool = globalForDbPool.__dbPoolRef;
  if (!pool) return;
  const total = Number(pool.totalCount ?? 0);
  const idle = Number(pool.idleCount ?? 0);
  const waiting = Number(pool.waitingCount ?? 0);
  metrics.db.pool.set({ state: "total" }, total);
  metrics.db.pool.set({ state: "idle" }, idle);
  metrics.db.pool.set({ state: "active" }, Math.max(0, total - idle));
  metrics.db.pool.set({ state: "waiting" }, waiting);
}
