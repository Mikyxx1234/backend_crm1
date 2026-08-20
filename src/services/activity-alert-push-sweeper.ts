/**
 * Dispara avisos de tarefa via FCM mesmo com o CRM fechado.
 * Só itera usuários com token nativo (endpoint fcm:) para não "roubar"
 * o popup interno de quem só usa desktop.
 */
import { prismaBase } from "@/lib/prisma-base";
import { withSystemContext } from "@/lib/webhook-context";
import { FCM_ENDPOINT_PREFIX } from "@/lib/fcm";
import { getNextActivityAlert } from "@/services/activity-alerts";

const INTERVAL_MS =
  Number(process.env.ACTIVITY_ALERT_PUSH_INTERVAL_MS) || 60_000;
let started = false;

export function startActivityAlertPushSweeper(): void {
  if (started) return;
  if (process.env.ACTIVITY_ALERT_PUSH_SWEEPER === "0") return;
  started = true;

  const tick = () => {
    void sweepActivityAlertPushes().catch((error) => {
      console.warn(
        "[activity-alert-push] tick falhou:",
        error instanceof Error ? error.message : error,
      );
    });
  };
  setTimeout(() => {
    tick();
    setInterval(tick, INTERVAL_MS);
  }, 30_000);
  console.info(`[activity-alert-push] sweeper iniciado (tick=${INTERVAL_MS}ms)`);
}

export async function sweepActivityAlertPushes(): Promise<{ users: number }> {
  const subs = await prismaBase.webPushSubscription.findMany({
    where: {
      failedAt: null,
      endpoint: { startsWith: FCM_ENDPOINT_PREFIX },
    },
    select: { userId: true, organizationId: true },
    distinct: ["userId", "organizationId"],
  });

  for (const sub of subs) {
    // getNextActivityAlert usa o prisma com escopo de tenant, que exige
    // RequestContext. Sem isto o worker morre no primeiro usuario e ninguem
    // recebe aviso com o app fechado.
    try {
      await withSystemContext(sub.organizationId, () =>
        getNextActivityAlert(sub.userId, sub.organizationId),
      );
    } catch (error) {
      console.warn(
        `[activity-alert-push] falha no usuario ${sub.userId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { users: subs.length };
}
