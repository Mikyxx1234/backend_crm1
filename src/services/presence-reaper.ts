import { recordPresenceTransition } from "@/lib/agent-presence";
import { prisma } from "@/lib/prisma";
import { sseBus } from "@/lib/sse-bus";

/**
 * Rebaixa automaticamente o status de agentes inativos.
 *
 * Regras (thresholds configuráveis via env):
 *  - ONLINE → AWAY:    `lastActivityAt` > PRESENCE_AWAY_MINUTES (default 5 min)
 *  - AWAY   → OFFLINE: `lastActivityAt` > PRESENCE_OFFLINE_MINUTES (default 15 min)
 *
 * Roda como setInterval in-process, disparado no boot do sse-bus. Não é escalável
 * horizontalmente em N réplicas sem coordenação — para isso, idealmente moveríamos
 * para BullMQ com um scheduler único. Na prática, executar o reaper em N instâncias
 * é idempotente (só atualiza se o status atual justifica mudar).
 */

const INTERVAL_MS = 60_000;
const AWAY_THRESHOLD_MIN = Number(process.env.PRESENCE_AWAY_MINUTES) || 5;
const OFFLINE_THRESHOLD_MIN = Number(process.env.PRESENCE_OFFLINE_MINUTES) || 15;

let started = false;

export function startPresenceReaper() {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      await reapOnce();
    } catch (err) {
      // Mais comum: migration lastActivityAt ainda não rodou em prod → log silencioso.
      console.warn(
        "[presence-reaper] tick falhou:",
        err instanceof Error ? err.message : err
      );
    }
  };

  // Primeiro tick em 10s (dá tempo do servidor estabilizar), depois a cada 60s.
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), INTERVAL_MS);
  }, 10_000);

  console.info(
    `[presence-reaper] iniciado (AWAY>${AWAY_THRESHOLD_MIN}min, OFFLINE>${OFFLINE_THRESHOLD_MIN}min)`
  );
}

/**
 * Executa um único ciclo de reap. Exportado separadamente para testes e para
 * permitir disparo manual via rota admin no futuro, se quisermos.
 */
export async function reapOnce() {
  const nowIso = new Date().toISOString();

  // ONLINE → AWAY
  const awayRows = await prisma.$queryRaw<{ userId: string }[]>`
    WITH updated AS (
      UPDATE "agent_statuses"
      SET status = 'AWAY', "updatedAt" = NOW()
      WHERE status = 'ONLINE'
        AND "lastActivityAt" IS NOT NULL
        AND "lastActivityAt" < (${nowIso}::timestamp - (${AWAY_THRESHOLD_MIN} || ' minutes')::interval)
      RETURNING "userId"
    )
    SELECT "userId" FROM updated
  `;

  for (const row of awayRows) {
    await recordPresenceTransition({ userId: row.userId, nextStatus: "AWAY" });
    sseBus.publish("presence_update", { userId: row.userId, status: "AWAY" });
  }

  // AWAY → OFFLINE
  const offlineRows = await prisma.$queryRaw<{ userId: string }[]>`
    WITH updated AS (
      UPDATE "agent_statuses"
      SET status = 'OFFLINE', "updatedAt" = NOW()
      WHERE status = 'AWAY'
        AND "lastActivityAt" IS NOT NULL
        AND "lastActivityAt" < (${nowIso}::timestamp - (${OFFLINE_THRESHOLD_MIN} || ' minutes')::interval)
      RETURNING "userId"
    )
    SELECT "userId" FROM updated
  `;

  for (const row of offlineRows) {
    await recordPresenceTransition({ userId: row.userId, nextStatus: "OFFLINE" });
    sseBus.publish("presence_update", { userId: row.userId, status: "OFFLINE" });
  }

  return { awayed: awayRows.length, offlined: offlineRows.length };
}
