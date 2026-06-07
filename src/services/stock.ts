/**
 * Service de saldo / livro-razão de StockMovement.
 *
 * REGRA DE OURO: NUNCA escrever direto em `Product.stock`, `Product.stockReserved`,
 * `ContractItem.balance`, `ContractItem.consumed` ou `ContractItem.reserved` sem
 * passar por `recordStockMovement` (ou um dos helpers que delegam pra cá).
 *
 * Escopo do movimento (determina O QUE muda):
 *   - Com `contractItemId`: opera sobre o pool do contrato (ContractItem).
 *   - Sem `contractItemId`: opera sobre o estoque global (Product).
 *
 * `balanceAfter` é SEMPRE o saldo resultante NO ESCOPO do movimento:
 *   - Escopo produto:   Product.stock após o movimento
 *   - Escopo contrato:  ContractItem.balance após o movimento
 *
 * Todos os helpers exigem ser chamados dentro de um `prisma.$transaction`
 * — assinatura recebe `tx` explícito para garantir atomicidade entre o
 * StockMovement e a mutação do saldo.
 */

import { Prisma } from "@prisma/client";

import type { ScopedTx } from "@/lib/prisma";
import { fireTrigger } from "@/services/automation-triggers";

export type StockMovementType =
  | "ENTRY"
  | "EXIT"
  | "ADJUSTMENT"
  | "RESERVE"
  | "CANCELLATION";

type Tx = ScopedTx;

export interface RecordStockMovementInput {
  organizationId: string;
  productId: string;
  /** Se presente, escopo do movimento é o ContractItem (pool isolado do contrato). */
  contractItemId?: string | null;
  /** Para rastreabilidade de auditoria. Não filtra automações. */
  dealId?: string | null;
  userId?: string | null;
  type: StockMovementType;
  /** Sempre positiva. Direção é determinada pelo `type`. */
  quantity: number;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface RecordStockMovementResult {
  movementId: string;
  balanceAfter: number;
  /** Saldo (Product.stock) após o movimento — sempre presente, mesmo no escopo contrato. */
  productStockAfter: number;
  /** Saldo de reserva (Product.stockReserved) após o movimento — sempre presente. */
  productReservedAfter: number;
}

/**
 * Aplica um movimento de saldo + cria o row de auditoria. Atômico via `tx`.
 *
 * Mapeamento por tipo:
 *   ENTRY        -> +balance (escopo correspondente)
 *   EXIT         -> -balance; em contrato, também +consumed
 *   ADJUSTMENT   -> +/-balance via metadata.direction ("INCREASE"|"DECREASE"); default INCREASE
 *   RESERVE      -> +reserved
 *   CANCELLATION -> -reserved
 *
 * `quantity` é tratada como ABSOLUTA. Para ADJUSTMENT, a direção vai em metadata.
 */
export async function recordStockMovement(
  tx: Tx,
  input: RecordStockMovementInput,
): Promise<RecordStockMovementResult> {
  if (input.quantity < 0 || !Number.isFinite(input.quantity)) {
    throw new Error(`recordStockMovement: quantity inválida (${input.quantity}).`);
  }
  const qty = input.quantity;

  // Snapshot atual do produto (sempre lemos)
  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true,
      organizationId: true,
      stock: true,
      stockReserved: true,
      trackStock: true,
    },
  });
  if (!product) {
    throw new Error(`recordStockMovement: produto ${input.productId} não encontrado.`);
  }
  if (product.organizationId !== input.organizationId) {
    throw new Error("recordStockMovement: organizationId não bate com o produto.");
  }

  // Escopo contrato: opera no ContractItem
  if (input.contractItemId) {
    const item = await tx.contractItem.findUnique({
      where: { id: input.contractItemId },
      select: {
        id: true,
        productId: true,
        balance: true,
        consumed: true,
        reserved: true,
        contract: { select: { id: true, organizationId: true } },
      },
    });
    if (!item) {
      throw new Error(
        `recordStockMovement: ContractItem ${input.contractItemId} não encontrado.`,
      );
    }
    if (item.productId !== input.productId) {
      throw new Error("recordStockMovement: produto não pertence ao ContractItem.");
    }
    if (item.contract.organizationId !== input.organizationId) {
      throw new Error(
        "recordStockMovement: ContractItem pertence a outra organização.",
      );
    }

    const balance = Number(item.balance);
    const consumed = Number(item.consumed);
    const reserved = Number(item.reserved);

    const direction =
      input.metadata && typeof input.metadata.direction === "string"
        ? input.metadata.direction.toUpperCase()
        : "INCREASE";

    let nextBalance = balance;
    let nextConsumed = consumed;
    let nextReserved = reserved;

    switch (input.type) {
      case "ENTRY":
        nextBalance = balance + qty;
        break;
      case "EXIT":
        nextBalance = balance - qty;
        nextConsumed = consumed + qty;
        break;
      case "ADJUSTMENT":
        nextBalance = direction === "DECREASE" ? balance - qty : balance + qty;
        break;
      case "RESERVE":
        nextReserved = reserved + qty;
        break;
      case "CANCELLATION":
        nextReserved = Math.max(0, reserved - qty);
        break;
    }

    await tx.contractItem.update({
      where: { id: input.contractItemId },
      data: {
        balance: nextBalance,
        consumed: nextConsumed,
        reserved: nextReserved,
      },
    });

    const mv = await tx.stockMovement.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        contractId: item.contract.id,
        dealId: input.dealId ?? null,
        userId: input.userId ?? null,
        type: input.type,
        quantity: qty,
        balanceAfter: nextBalance,
        reason: input.reason ?? null,
        metadata: input.metadata == null ? Prisma.JsonNull : (input.metadata as Prisma.InputJsonValue),
      },
      select: { id: true },
    });

    return {
      movementId: mv.id,
      balanceAfter: nextBalance,
      productStockAfter: Number(product.stock),
      productReservedAfter: Number(product.stockReserved),
    };
  }

  // Escopo produto: opera em Product.stock / Product.stockReserved
  const stock = Number(product.stock);
  const reserved = Number(product.stockReserved);

  const direction =
    input.metadata && typeof input.metadata.direction === "string"
      ? input.metadata.direction.toUpperCase()
      : "INCREASE";

  let nextStock = stock;
  let nextReserved = reserved;

  switch (input.type) {
    case "ENTRY":
      nextStock = stock + qty;
      break;
    case "EXIT":
      nextStock = stock - qty;
      break;
    case "ADJUSTMENT":
      nextStock = direction === "DECREASE" ? stock - qty : stock + qty;
      break;
    case "RESERVE":
      nextReserved = reserved + qty;
      break;
    case "CANCELLATION":
      nextReserved = Math.max(0, reserved - qty);
      break;
  }

  await tx.product.update({
    where: { id: input.productId },
    data: { stock: nextStock, stockReserved: nextReserved },
  });

  const mv = await tx.stockMovement.create({
    data: {
      organizationId: input.organizationId,
      productId: input.productId,
      contractId: null,
      dealId: input.dealId ?? null,
      userId: input.userId ?? null,
      type: input.type,
      quantity: qty,
      balanceAfter: nextStock,
      reason: input.reason ?? null,
      metadata: input.metadata == null ? Prisma.JsonNull : (input.metadata as Prisma.InputJsonValue),
    },
    select: { id: true },
  });

  return {
    movementId: mv.id,
    balanceAfter: nextStock,
    productStockAfter: nextStock,
    productReservedAfter: nextReserved,
  };
}

/**
 * Consome estoque dos DealProducts ao fechar um deal em WON. Para CADA
 * DealProduct.product.trackStock=true:
 *   1. Cria StockMovement EXIT no escopo correto (contrato vinculado OU produto).
 *   2. Decrementa Product.stockReserved da quantidade RESERVE pendente (se houver).
 *   3. Avalia thresholds e dispara eventos:
 *        - `resource_consumed` (sempre)
 *        - `balance_low`       (saldo <= stockAlertAt)
 *        - `balance_zero`      (saldo <= 0)
 *
 * Idempotência: se o deal já está WON e a função for chamada novamente, não
 * aplica o EXIT em duplicidade. Detecta via existência de StockMovement EXIT
 * pra esse `dealId` no mesmo produto.
 */
export async function consumeDealProductsOnWon(
  tx: Tx,
  args: {
    dealId: string;
    organizationId: string;
    userId?: string | null;
  },
): Promise<
  Array<{
    productId: string;
    productName: string;
    quantity: number;
    balanceAfter: number;
    alertThreshold: number | null;
    triggered: { resourceConsumed: boolean; balanceLow: boolean; balanceZero: boolean };
  }>
> {
  const dealProducts = await tx.dealProduct.findMany({
    where: { dealId: args.dealId },
    select: {
      id: true,
      productId: true,
      quantity: true,
      product: {
        select: {
          id: true,
          name: true,
          trackStock: true,
          stock: true,
          stockReserved: true,
          stockAlertAt: true,
        },
      },
    },
  });

  const summaries: Array<{
    productId: string;
    productName: string;
    quantity: number;
    balanceAfter: number;
    alertThreshold: number | null;
    triggered: { resourceConsumed: boolean; balanceLow: boolean; balanceZero: boolean };
  }> = [];

  for (const dp of dealProducts) {
    if (!dp.product.trackStock) continue;
    const qty = Number(dp.quantity);
    if (qty <= 0) continue;

    // Idempotência: se já houver EXIT para esse (deal, produto), não duplicar.
    const alreadyExited = await tx.stockMovement.count({
      where: {
        dealId: args.dealId,
        productId: dp.productId,
        type: "EXIT",
      },
    });
    if (alreadyExited > 0) continue;

    // Cancela qualquer RESERVE pendente desse deal/produto (libera stockReserved).
    const reservedForDeal = await tx.stockMovement.aggregate({
      where: { dealId: args.dealId, productId: dp.productId, type: "RESERVE" },
      _sum: { quantity: true },
    });
    const canceledReserve = await tx.stockMovement.aggregate({
      where: { dealId: args.dealId, productId: dp.productId, type: "CANCELLATION" },
      _sum: { quantity: true },
    });
    const reserveNet = Number(reservedForDeal._sum.quantity ?? 0) - Number(canceledReserve._sum.quantity ?? 0);
    if (reserveNet > 0) {
      await recordStockMovement(tx, {
        organizationId: args.organizationId,
        productId: dp.productId,
        dealId: args.dealId,
        userId: args.userId ?? null,
        type: "CANCELLATION",
        quantity: reserveNet,
        reason: "deal_won_release_reserve",
      });
    }

    const result = await recordStockMovement(tx, {
      organizationId: args.organizationId,
      productId: dp.productId,
      dealId: args.dealId,
      userId: args.userId ?? null,
      type: "EXIT",
      quantity: qty,
      reason: "deal_won",
    });

    const alertAt = dp.product.stockAlertAt !== null ? Number(dp.product.stockAlertAt) : null;
    const balanceAfter = result.balanceAfter;
    summaries.push({
      productId: dp.productId,
      productName: dp.product.name,
      quantity: qty,
      balanceAfter,
      alertThreshold: alertAt,
      triggered: {
        resourceConsumed: true,
        balanceLow: alertAt !== null && balanceAfter <= alertAt,
        balanceZero: balanceAfter <= 0,
      },
    });
  }

  return summaries;
}

/**
 * Dispara os eventos de automação para o sumário retornado por
 * `consumeDealProductsOnWon`. NÃO é chamado DENTRO da transação — emit
 * acontece após o COMMIT pra evitar disparos fantasma se o tx der rollback.
 */
export async function fireConsumptionEvents(
  summary: Array<{
    productId: string;
    productName: string;
    quantity: number;
    balanceAfter: number;
    alertThreshold: number | null;
    triggered: { resourceConsumed: boolean; balanceLow: boolean; balanceZero: boolean };
  }>,
  ctx: { organizationId: string; dealId: string; userId?: string | null },
): Promise<void> {
  for (const s of summary) {
    const payload = {
      organizationId: ctx.organizationId,
      productId: s.productId,
      productName: s.productName,
      dealId: ctx.dealId,
      quantity: s.quantity,
      currentBalance: s.balanceAfter,
      alertThreshold: s.alertThreshold,
      userId: ctx.userId ?? null,
    };
    if (s.triggered.resourceConsumed) {
      await fireTrigger("resource_consumed", { dealId: ctx.dealId, data: payload });
    }
    if (s.triggered.balanceZero) {
      await fireTrigger("balance_zero", { dealId: ctx.dealId, data: payload });
    } else if (s.triggered.balanceLow) {
      await fireTrigger("balance_low", { dealId: ctx.dealId, data: payload });
    }
  }
}
