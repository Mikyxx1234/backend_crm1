import { recordPresenceTransition } from "@/lib/agent-presence";
import { prismaBase as prisma } from "@/lib/prisma-base";
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

/**
 * DEPRECATED (jul/26): a "presença por ping" foi separada da disponibilidade
 * da Distribuição. O sweeper que fecha sessões de USO vive agora em
 * `system-presence.ts` (`startSystemPresenceSweeper`).
 *
 * A função é mantida como no-op para preservar compat com quem ainda
 * a importe. `reapOnce()` continua exportado para usos ad-hoc/testes,
 * mas NÃO é agendado automaticamente.
 */
export function startPresenceReaper() {
  if (started) return;
  started = true;
  console.info(
    "[presence-reaper] DEPRECATED — nenhum tick agendado. Use system-presence sweeper.",
  );
}

/**
 * Executa um único ciclo de reap. Exportado separadamente para testes e para
 * permitir disparo manual via rota admin no futuro, se quisermos.
 *
 * PR-1.1 audit: SYSTEM-CONTEXT — usa prismaBase (sem extension de scope).
 * As 2 queries são cross-tenant (varrem agent_statuses de TODAS as orgs)
 * porque o reaper é housekeeping global. Já retornam organizationId no
 * RETURNING para que o SSE publish entregue eventos só ao tenant correto.
 *
 * TODO PR-1.4 (RLS): wrappear este corpo em withSuperAdminContext() para
 * setar `SET LOCAL app.is_super_admin = true` no nível da conexão. Sem
 * isso, com RLS ativa, os UPDATEs não atingem nenhuma linha (current_org=NULL).
 */
export async function reapOnce() {
  const nowIso = new Date().toISOString();

  // ONLINE → AWAY (cross-tenant: o reaper roda sem RequestContext;
  // retornamos organizationId pra que o SSE publish caia na org certa)
  const awayRows = await prisma.$queryRaw<
    { userId: string; organizationId: string }[]
  >`
    WITH updated AS (
      UPDATE "agent_statuses"
      SET status = 'AWAY', "updatedAt" = NOW()
      WHERE status = 'ONLINE'
        AND "lastActivityAt" IS NOT NULL
        AND "lastActivityAt" < (${nowIso}::timestamp - (${AWAY_THRESHOLD_MIN} || ' minutes')::interval)
      RETURNING "userId", "organizationId"
    )
    SELECT "userId", "organizationId" FROM updated
  `;

  for (const row of awayRows) {
    await recordPresenceTransition({ userId: row.userId, nextStatus: "AWAY" });
    sseBus.publish("presence_update", {
      organizationId: row.organizationId,
      userId: row.userId,
      status: "AWAY",
    });
  }

  // AWAY → OFFLINE
  const offlineRows = await prisma.$queryRaw<
    { userId: string; organizationId: string }[]
  >`
    WITH updated AS (
      UPDATE "agent_statuses"
      SET status = 'OFFLINE', "updatedAt" = NOW()
      WHERE status = 'AWAY'
        AND "lastActivityAt" IS NOT NULL
        AND "lastActivityAt" < (${nowIso}::timestamp - (${OFFLINE_THRESHOLD_MIN} || ' minutes')::interval)
      RETURNING "userId", "organizationId"
    )
    SELECT "userId", "organizationId" FROM updated
  `;

  for (const row of offlineRows) {
    await recordPresenceTransition({ userId: row.userId, nextStatus: "OFFLINE" });
    sseBus.publish("presence_update", {
      organizationId: row.organizationId,
      userId: row.userId,
      status: "OFFLINE",
    });
  }

  return { awayed: awayRows.length, offlined: offlineRows.length };
}
