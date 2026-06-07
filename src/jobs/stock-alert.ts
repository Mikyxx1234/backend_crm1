/**
 * Job: stock-alert
 *
 * Varre TODOS os produtos da plataforma com `trackStock=true` e
 * `stockAlertAt IS NOT NULL`, e dispara eventos de automação quando
 * o saldo atual cruza os thresholds:
 *   - `balance_zero` quando stock <= 0
 *   - `balance_low`  quando stock <= stockAlertAt (e > 0)
 *
 * Idempotência: o job NÃO mantém estado próprio. Para evitar disparos
 * repetidos a cada execução, use no consumidor das automações um
 * de-bounce/janela (ex.: "só notificar 1x por dia por produto"). Aqui
 * a responsabilidade é apenas DETECTAR e DISPARAR.
 *
 * Como invocar:
 *   - Diariamente via cron (ex.: rota `/api/cron/stock-alert` chamando
 *     `runStockAlertJob()`)
 *   - Pontualmente após um StockMovement EXIT/ADJUSTMENT_DECREASE (já é
 *     coberto pelo hook em deals.markDealWon → fireConsumptionEvents,
 *     então o job é principalmente um "safety-net" diário).
 *
 * Permissão de execução: o job ignora RLS via runWithContext com
 * isSuperAdmin=true (rotina de sistema, não-tenant-scoped).
 */

import { prisma } from "@/lib/prisma";
import { runWithContext } from "@/lib/request-context";
import { fireTrigger } from "@/services/automation-triggers";

export interface StockAlertResult {
  scanned: number;
  zeroAlerts: number;
  lowAlerts: number;
  errors: Array<{ productId: string; message: string }>;
}

export async function runStockAlertJob(): Promise<StockAlertResult> {
  // Executamos como super-admin para varrer todas as orgs. As automacoes
  // disparadas vao herdar o `organizationId` do payload de cada evento.
  return runWithContext(
    {
      organizationId: null,
      userId: "system-stock-alert-job",
      isSuperAdmin: true,
      actor: {
        type: "SYSTEM",
        label: "stock-alert-job",
        sublabel: "rotina diária de alerta de saldo",
        ref: null,
      },
    },
    async () => {
      const errors: Array<{ productId: string; message: string }> = [];
      let zeroAlerts = 0;
      let lowAlerts = 0;

      const products = await prisma.product.findMany({
        where: {
          isActive: true,
          trackStock: true,
          stockAlertAt: { not: null },
        },
        select: {
          id: true,
          name: true,
          organizationId: true,
          stock: true,
          stockAlertAt: true,
        },
      });

      for (const p of products) {
        try {
          const stock = Number(p.stock);
          const threshold = Number(p.stockAlertAt);
          const basePayload = {
            organizationId: p.organizationId,
            productId: p.id,
            productName: p.name,
            currentBalance: stock,
            alertThreshold: threshold,
            userId: null as string | null,
          };
          if (stock <= 0) {
            await fireTrigger("balance_zero", { data: basePayload });
            zeroAlerts++;
          } else if (stock <= threshold) {
            await fireTrigger("balance_low", { data: basePayload });
            lowAlerts++;
          }
        } catch (e) {
          errors.push({
            productId: p.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      return {
        scanned: products.length,
        zeroAlerts,
        lowAlerts,
        errors,
      };
    },
  );
}
