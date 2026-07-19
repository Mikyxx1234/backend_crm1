/**
 * Cotas de Desconto (PRD Cotas — Fase 1) — porta ÚNICA de escrita.
 *
 * Espelha o padrão do `src/services/inventory.ts`: nenhum route handler
 * altera `qtyConsumed` diretamente. Todas as transições passam por este
 * serviço, sob `prisma.$transaction` com UPDATE condicional (RN-06),
 * gravando um registro em `quota_movements` na mesma transação — o
 * ledger é a fonte de verdade auditável (RN-09).
 *
 * Regras de negócio aqui:
 *   RN-01  Matching de cotas elegíveis para um deal (produto + unidade).
 *   RN-02  Seleção NÃO consome (a menos que RN-05 dispare reserva).
 *   RN-03  Cumulatividade (grupo de exclusão + maxStacks).
 *   RN-04  Cálculo do preço final (cascata / soma simples) + snapshots.
 *   RN-05  Threshold de reserva parametrizável (policy default ou por cota).
 *   RN-06  Consumo atômico (anti-overbooking).
 *   RN-07  Transições ao ganhar/reverter o deal.
 *
 * Erros são tipados (subclasses de `QuotaError`) para as rotas mapearem em
 * mensagens amigáveis + códigos semânticos (`COTA_ESGOTADA`, etc.).
 */
import { Prisma } from "@prisma/client";
import type {
  DealQuotaStatus,
  DiscountType,
  QuotaCalcMode,
  QuotaConsumeMoment,
  QuotaMovementType,
} from "@prisma/client";

import { prisma, type ScopedTx } from "@/lib/prisma";
import { withOrg } from "@/lib/prisma-helpers";
import { getOrgIdOrThrow } from "@/lib/request-context";

const Decimal = Prisma.Decimal;
type DecimalT = Prisma.Decimal;

/* ────────────────────────── erros tipados ─────────────────────────── */

export class QuotaError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "QuotaError";
  }
}

export class QuotaExhaustedError extends QuotaError {
  constructor(readonly quotaId: string) {
    super("COTA_ESGOTADA", `Cota ${quotaId} esgotada ou fora de vigência.`);
    this.name = "QuotaExhaustedError";
  }
}

export class QuotaOutOfPeriodError extends QuotaError {
  constructor(readonly quotaId: string) {
    super("COTA_FORA_VIGENCIA", `Cota ${quotaId} fora do período de vigência.`);
    this.name = "QuotaOutOfPeriodError";
  }
}

export class QuotaNotStackableError extends QuotaError {
  constructor(readonly reason: string) {
    super("COTA_NAO_ACUMULAVEL", reason);
    this.name = "QuotaNotStackableError";
  }
}

export class QuotaReservationExpiredError extends QuotaError {
  constructor(readonly dealQuotaId: string) {
    super("RESERVA_EXPIRADA", `Reserva ${dealQuotaId} expirada.`);
    this.name = "QuotaReservationExpiredError";
  }
}

/* ────────────────────────── tipos públicos ────────────────────────── */

export type AvailableQuota = {
  id: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  productId: string | null;
  orgUnitId: string | null;
  qtyTotal: number | null;
  qtyConsumed: number;
  /** Saldo restante (qtyTotal - qtyConsumed) ou null se ilimitada. */
  balance: number | null;
  validFrom: Date;
  validTo: Date | null;
  exclusionGroup: string | null;
  maxStacks: number;
  calcMode: QuotaCalcMode;
  /** ID da categoria vinculada (fonte da verdade de % + regras), se houver. */
  categoryId: string | null;
  /** Nome da categoria (para agrupar/exibir no picker do vendedor). */
  categoryName: string | null;
};

/**
 * Snapshot do valor/regras efetivas de uma cota.
 * Quando existe categoria vinculada e ativa, ela sobrepõe as colunas locais
 * (a categoria é a fonte da verdade de % + regras). Vigência da categoria
 * também restringe a da cota (retorna null se fora do período).
 */
type EffectiveTerms = {
  discountType: DiscountType;
  discountValue: Prisma.Decimal;
  exclusionGroup: string | null;
  maxStacks: number;
  calcMode: QuotaCalcMode;
  validFrom: Date;
  validTo: Date | null;
  categoryId: string | null;
  categoryName: string | null;
  productId: string | null;
};

type QuotaRowForResolve = {
  discountType: DiscountType;
  discountValue: Prisma.Decimal;
  productId: string | null;
  exclusionGroup: string | null;
  maxStacks: number;
  calcMode: QuotaCalcMode;
  validFrom: Date;
  validTo: Date | null;
  categoryId: string | null;
  category: {
    id: string;
    name: string;
    discountType: DiscountType;
    discountValue: Prisma.Decimal;
    productId: string | null;
    exclusionGroup: string | null;
    maxStacks: number;
    calcMode: QuotaCalcMode;
    validFrom: Date;
    validTo: Date | null;
    active: boolean;
  } | null;
};

function resolveEffectiveTerms(q: QuotaRowForResolve): EffectiveTerms {
  const c = q.category;
  if (c && c.active) {
    return {
      discountType: c.discountType,
      discountValue: c.discountValue,
      exclusionGroup: c.exclusionGroup,
      maxStacks: c.maxStacks,
      calcMode: c.calcMode,
      // Vigência efetiva = interseção categoria × cota (mais restritiva).
      validFrom: c.validFrom > q.validFrom ? c.validFrom : q.validFrom,
      validTo:
        c.validTo === null
          ? q.validTo
          : q.validTo === null
            ? c.validTo
            : c.validTo < q.validTo
              ? c.validTo
              : q.validTo,
      categoryId: c.id,
      categoryName: c.name,
      // Produto efetivo = categoria tem precedência (fonte da verdade).
      productId: c.productId ?? q.productId,
    };
  }
  return {
    discountType: q.discountType,
    discountValue: q.discountValue,
    exclusionGroup: q.exclusionGroup,
    maxStacks: q.maxStacks,
    calcMode: q.calcMode,
    validFrom: q.validFrom,
    validTo: q.validTo,
    categoryId: null,
    categoryName: null,
    productId: q.productId,
  };
}

export type SelectQuotaInput = {
  dealId: string;
  quotaId: string;
  userId?: string | null;
};

export type SelectQuotaResult = {
  dealQuotaId: string;
  status: DealQuotaStatus;
  reservedAt: Date | null;
  expiresAt: Date | null;
  priceFinalSnapshot: number | null;
  priceFullSnapshot: number | null;
};

/* ─────────────────────── util: seleção do preço cheio ─────────────── */

/**
 * Preço "cheio" do deal (sem cotas aplicadas). Reutiliza o cálculo já
 * feito no `deal_products` (linha × quantidade × (1 - discountPct/100)),
 * mesmo shape usado por `recalcDealValue` nas rotas de produtos.
 *
 * Nota: o `deal_products.discount` é o desconto de linha do vendedor
 * (distinto do desconto por cota). É legítimo mantê-lo aqui — a cota
 * incide sobre o total, alinhado com como o valor do deal é exibido.
 */
async function computeDealFullPrice(
  tx: ScopedTx | typeof prisma,
  dealId: string,
): Promise<DecimalT> {
  const items = await tx.dealProduct.findMany({
    where: { dealId },
    select: { quantity: true, unitPrice: true, discount: true },
  });
  let total = new Decimal(0);
  for (const it of items) {
    const qty = new Decimal(it.quantity);
    const price = new Decimal(it.unitPrice);
    const disc = new Decimal(it.discount);
    const line = qty.mul(price).mul(new Decimal(100).minus(disc).div(100));
    total = total.plus(line);
  }
  return total;
}

/* ───────────────────────────── RN-01: matching ────────────────────── */

/**
 * Lista cotas elegíveis para um deal (produto opcional × unidade opcional).
 *
 * Uma cota é elegível quando:
 *   - `active = true`
 *   - `productId IS NULL OR productId = :productId`
 *   - `orgUnitId IS NULL OR orgUnitId = :orgUnitId`
 *   - vigência: NOW BETWEEN validFrom AND COALESCE(validTo, +∞)
 *   - saldo: qtyTotal IS NULL OR qtyConsumed < qtyTotal
 *
 * Ordena por `discountValue DESC` para o vendedor ver primeiro as maiores.
 * `productId`/`orgUnitId` null no deal = wildcard (só cotas globais casam).
 */
export async function listAvailableForDeal(args: {
  productId?: string | null;
  orgUnitId?: string | null;
}): Promise<AvailableQuota[]> {
  const now = new Date();
  const rows = await prisma.discountQuota.findMany({
    where: {
      active: true,
      AND: [
        args.orgUnitId
          ? { OR: [{ orgUnitId: null }, { orgUnitId: args.orgUnitId }] }
          : { orgUnitId: null },
      ],
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          discountType: true,
          discountValue: true,
          productId: true,
          exclusionGroup: true,
          maxStacks: true,
          calcMode: true,
          validFrom: true,
          validTo: true,
          active: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  const out: AvailableQuota[] = [];
  for (const r of rows) {
    // Saldo primeiro (barato).
    if (r.qtyTotal !== null && r.qtyConsumed >= r.qtyTotal) continue;

    const eff = resolveEffectiveTerms(r);

    // Vigência efetiva (categoria × cota).
    if (eff.validFrom > now) continue;
    if (eff.validTo !== null && eff.validTo < now) continue;

    // Escopo por produto (categoria pode sobrepor).
    if (args.productId) {
      if (eff.productId !== null && eff.productId !== args.productId) continue;
    } else {
      if (eff.productId !== null) continue;
    }

    out.push({
      id: r.id,
      name: r.name,
      discountType: eff.discountType,
      discountValue: Number(eff.discountValue),
      productId: eff.productId,
      orgUnitId: r.orgUnitId,
      qtyTotal: r.qtyTotal,
      qtyConsumed: r.qtyConsumed,
      balance: r.qtyTotal === null ? null : r.qtyTotal - r.qtyConsumed,
      validFrom: eff.validFrom,
      validTo: eff.validTo,
      exclusionGroup: eff.exclusionGroup,
      maxStacks: eff.maxStacks,
      calcMode: eff.calcMode,
      categoryId: eff.categoryId,
      categoryName: eff.categoryName,
    });
  }

  // Ordena por maior desconto (após resolver).
  out.sort((a, b) => b.discountValue - a.discountValue);
  return out;
}

/* ──────────────────────── RN-05: política de consumo ──────────────── */

type PolicyResolved = {
  consumeMoment: QuotaConsumeMoment;
  reserveThreshold: number | null;
  reserveTtlHours: number;
};

async function resolvePolicy(
  tx: ScopedTx | typeof prisma,
  quotaId: string,
  orgId: string,
): Promise<PolicyResolved> {
  // Específica da cota tem precedência.
  const specific = await tx.quotaConsumptionPolicy.findFirst({
    where: { quotaId, active: true },
    select: {
      consumeMoment: true,
      reserveThreshold: true,
      reserveTtlHours: true,
    },
  });
  if (specific) return specific;

  const def = await tx.quotaConsumptionPolicy.findFirst({
    where: { quotaId: null, active: true, organizationId: orgId },
    select: {
      consumeMoment: true,
      reserveThreshold: true,
      reserveTtlHours: true,
    },
  });
  if (def) return def;

  // Fallback embutido (não requer nenhuma linha para operar).
  return { consumeMoment: "ON_WIN", reserveThreshold: null, reserveTtlHours: 48 };
}

/* ──────────────────────── RN-03: cumulatividade ───────────────────── */

/**
 * Valida se `candidate` pode ser adicionada dado o conjunto `existing` já
 * associado ao deal com status ativo (SELECTED/RESERVED/CONSUMED).
 *
 * 1. Grupo de exclusão: nenhuma existente pode ter o mesmo `exclusionGroup`
 *    (quando não-nulo) que a candidata.
 * 2. `maxStacks = 1` em qualquer envolvida => não acumula.
 * 3. `total (existentes+1) <= min(maxStacks) entre TODAS as envolvidas`.
 */
type StackableRow = {
  quotaId: string;
  exclusionGroup: string | null;
  maxStacks: number;
};

function assertStackable(
  existing: StackableRow[],
  candidate: StackableRow,
): void {
  if (existing.length === 0) return;

  if (candidate.exclusionGroup) {
    const clash = existing.find(
      (e) => e.exclusionGroup === candidate.exclusionGroup,
    );
    if (clash) {
      throw new QuotaNotStackableError(
        `Cotas do mesmo grupo "${candidate.exclusionGroup}" não são acumuláveis.`,
      );
    }
  }

  const involved = [...existing, candidate];
  const hasNoStack = involved.some((q) => q.maxStacks <= 1);
  if (hasNoStack) {
    throw new QuotaNotStackableError(
      "Uma das cotas envolvidas não é acumulável (maxStacks = 1).",
    );
  }

  const minStacks = Math.min(...involved.map((q) => q.maxStacks));
  if (involved.length > minStacks) {
    throw new QuotaNotStackableError(
      `Limite de acúmulo atingido (${minStacks}).`,
    );
  }
}

/* ──────────────────────── RN-04: cálculo do preço ─────────────────── */

/**
 * Aplica as cotas ao preço cheio segundo o modo dominante do conjunto.
 * Se houver mix de modos, força CASCADE (mais conservador, PRD RN-04).
 *
 * CASCADE: percentuais em ordem decrescente, depois valores fixos, um
 * após o outro sobre o valor remanescente. `GREATEST(x,0)` no fim.
 *
 * SUM_SIMPLE: soma dos percentuais aplicada uma única vez, depois soma
 * dos fixos (subtrai do subtotal). `GREATEST(x,0)` no fim.
 */
function applyQuotasToPrice(
  full: DecimalT,
  quotas: Array<{
    discountType: DiscountType;
    discountValue: DecimalT;
    calcMode: QuotaCalcMode;
  }>,
): DecimalT {
  if (quotas.length === 0 || full.lte(0)) {
    return full.lt(0) ? new Decimal(0) : full;
  }

  const anyCascade = quotas.some((q) => q.calcMode === "CASCADE");
  const mode: QuotaCalcMode = anyCascade ? "CASCADE" : "SUM_SIMPLE";

  const percents = quotas.filter((q) => q.discountType === "PERCENT");
  const fixeds = quotas.filter((q) => q.discountType === "FIXED");

  if (mode === "CASCADE") {
    let price = full;
    const orderedPercents = [...percents].sort((a, b) =>
      new Decimal(b.discountValue).cmp(new Decimal(a.discountValue)),
    );
    for (const p of orderedPercents) {
      const pct = new Decimal(p.discountValue);
      price = price.mul(new Decimal(100).minus(pct).div(100));
    }
    for (const f of fixeds) {
      price = price.minus(new Decimal(f.discountValue));
    }
    return Decimal.max(price, new Decimal(0));
  }

  // SUM_SIMPLE
  const pctSum = percents.reduce(
    (acc, p) => acc.plus(new Decimal(p.discountValue)),
    new Decimal(0),
  );
  const fxSum = fixeds.reduce(
    (acc, f) => acc.plus(new Decimal(f.discountValue)),
    new Decimal(0),
  );
  const afterPct = full.mul(new Decimal(100).minus(pctSum).div(100));
  const final = afterPct.minus(fxSum);
  return Decimal.max(final, new Decimal(0));
}

/**
 * Recalcula e grava os snapshots (preço cheio + preço final) considerando
 * o conjunto atual de cotas ativas do deal. Chamado após select/remove
 * dentro da MESMA transação para consistência.
 */
async function refreshDealPriceSnapshots(
  tx: ScopedTx,
  dealId: string,
): Promise<{ full: number; final: number }> {
  const dealQuotas = await tx.dealQuota.findMany({
    where: {
      dealId,
      status: { in: ["SELECTED", "RESERVED", "CONSUMED"] },
    },
    select: {
      valueSnapshot: true,
      typeSnapshot: true,
      quota: {
        select: {
          calcMode: true,
          category: { select: { calcMode: true, active: true } },
        },
      },
    },
  });
  const full = await computeDealFullPrice(tx, dealId);
  const final = applyQuotasToPrice(
    full,
    dealQuotas.map((dq) => ({
      discountType: dq.typeSnapshot,
      discountValue: new Decimal(dq.valueSnapshot),
      // Categoria vence quando presente e ativa.
      calcMode:
        dq.quota.category && dq.quota.category.active
          ? dq.quota.category.calcMode
          : dq.quota.calcMode,
    })),
  );
  await tx.deal.update({
    where: { id: dealId },
    data: {
      priceFullSnapshot: full,
      priceFinalSnapshot: final,
    },
  });
  return { full: Number(full), final: Number(final) };
}

/* ──────────────────────── RN-06: consumo atômico ──────────────────── */

/**
 * UPDATE condicional: incrementa `qtyConsumed` se saldo e vigência
 * permitirem. Retorna a linha atualizada ou nada (0 linhas). Cliente
 * deve tratar o resultado vazio como `COTA_ESGOTADA`.
 *
 * Escapa a Prisma Extension (queryRaw ignora `applyOrgScope`), por isso
 * o `organizationId` entra no WHERE manualmente.
 */
async function atomicallyIncrementConsumption(
  tx: ScopedTx,
  quotaId: string,
  orgId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "discount_quotas"
    SET "qtyConsumed" = "qtyConsumed" + 1, "updatedAt" = NOW()
    WHERE "id" = ${quotaId}
      AND "organizationId" = ${orgId}
      AND "active" = true
      AND ("qtyTotal" IS NULL OR "qtyConsumed" < "qtyTotal")
      AND "validFrom" <= NOW()
      AND ("validTo" IS NULL OR "validTo" >= NOW())
    RETURNING "id";
  `;
  return rows.length === 1;
}

/** Devolve saldo (decrementa `qtyConsumed`). Nunca vai abaixo de zero. */
async function decrementConsumption(
  tx: ScopedTx,
  quotaId: string,
  orgId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "discount_quotas"
    SET "qtyConsumed" = GREATEST("qtyConsumed" - 1, 0),
        "updatedAt" = NOW()
    WHERE "id" = ${quotaId}
      AND "organizationId" = ${orgId};
  `;
}

async function recordMovement(
  tx: ScopedTx,
  args: {
    quotaId: string;
    dealId?: string | null;
    type: QuotaMovementType;
    qty?: number;
    userId?: string | null;
    reason?: string | null;
  },
  orgId: string,
): Promise<void> {
  await tx.quotaMovement.create({
    data: withOrg(
      {
        quotaId: args.quotaId,
        dealId: args.dealId ?? null,
        type: args.type,
        qty: args.qty ?? 1,
        userId: args.userId ?? null,
        reason: args.reason ?? null,
      },
      orgId,
    ),
    select: { id: true },
  });
}

/* ─────────────────────────── RN-02 + RN-03 + RN-05 ────────────────── */

/**
 * Seleciona uma cota para um deal. Aplica cumulatividade (RN-03) contra
 * as cotas SELECTED/RESERVED/CONSUMED já vinculadas, resolve a política
 * (RN-05) e, se preciso, faz a reserva com consumo atômico (RN-06).
 *
 * Grava `DealQuota` + `QuotaMovement` na mesma transação e atualiza os
 * snapshots de preço do deal (RN-04).
 */
export async function selectQuotaForDeal(
  input: SelectQuotaInput,
): Promise<SelectQuotaResult> {
  const orgId = getOrgIdOrThrow();
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // Confirma existência da cota + snapshot dos campos que usaremos.
    const quota = await tx.discountQuota.findUnique({
      where: { id: input.quotaId },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            discountType: true,
            discountValue: true,
            productId: true,
            exclusionGroup: true,
            maxStacks: true,
            calcMode: true,
            validFrom: true,
            validTo: true,
            active: true,
          },
        },
      },
    });
    if (!quota || !quota.active) {
      throw new QuotaError("COTA_INEXISTENTE", "Cota não encontrada ou inativa.");
    }
    const eff = resolveEffectiveTerms(quota);
    if (
      eff.validFrom > now ||
      (eff.validTo !== null && eff.validTo < now)
    ) {
      throw new QuotaOutOfPeriodError(quota.id);
    }

    // Deal e escopo real.
    const deal = await tx.deal.findUnique({
      where: { id: input.dealId },
      select: { id: true, orgUnitId: true, products: { select: { productId: true } } },
    });
    if (!deal) {
      throw new QuotaError("DEAL_INEXISTENTE", "Negócio não encontrado.");
    }

    // Validação de escopo (o vendedor só pode escolher cota compatível).
    if (quota.orgUnitId && deal.orgUnitId && quota.orgUnitId !== deal.orgUnitId) {
      throw new QuotaError(
        "COTA_ESCOPO_INVALIDO",
        "Esta cota não vale para a unidade selecionada.",
      );
    }
    if (eff.productId) {
      const productMatches = deal.products.some(
        (p) => p.productId === eff.productId,
      );
      if (!productMatches) {
        throw new QuotaError(
          "COTA_ESCOPO_INVALIDO",
          "Esta cota exige um produto específico que não está no negócio.",
        );
      }
    }

    // Cotas já vinculadas (para cumulatividade). Resolve os termos efetivos
    // (categoria sobrepõe cota) para a validação de stackability.
    const existing = await tx.dealQuota.findMany({
      where: {
        dealId: input.dealId,
        status: { in: ["SELECTED", "RESERVED", "CONSUMED"] },
      },
      select: {
        quotaId: true,
        quota: {
          include: {
            category: {
              select: {
                id: true,
                name: true,
                discountType: true,
                discountValue: true,
                productId: true,
                exclusionGroup: true,
                maxStacks: true,
                calcMode: true,
                validFrom: true,
                validTo: true,
                active: true,
              },
            },
          },
        },
      },
    });
    if (existing.some((e) => e.quotaId === input.quotaId)) {
      throw new QuotaError(
        "COTA_JA_VINCULADA",
        "Esta cota já está vinculada ao negócio.",
      );
    }
    assertStackable(
      existing.map((e) => {
        const eeff = resolveEffectiveTerms(e.quota);
        return {
          quotaId: e.quotaId,
          exclusionGroup: eeff.exclusionGroup,
          maxStacks: eeff.maxStacks,
        };
      }),
      {
        quotaId: quota.id,
        exclusionGroup: eff.exclusionGroup,
        maxStacks: eff.maxStacks,
      },
    );

    // Resolve política (RN-05).
    const policy = await resolvePolicy(tx, quota.id, orgId);
    const balance =
      quota.qtyTotal === null ? null : quota.qtyTotal - quota.qtyConsumed;
    const reserveByThreshold =
      policy.reserveThreshold !== null &&
      balance !== null &&
      balance <= policy.reserveThreshold;
    const shouldReserve =
      policy.consumeMoment === "ON_RESERVE" || reserveByThreshold;

    let status: DealQuotaStatus = "SELECTED";
    let reservedAt: Date | null = null;
    let expiresAt: Date | null = null;

    if (shouldReserve) {
      // RN-06: consumo atômico. Se retorna false ⇒ esgotada/inválida.
      const ok = await atomicallyIncrementConsumption(tx, quota.id, orgId);
      if (!ok) {
        throw new QuotaExhaustedError(quota.id);
      }
      status = "RESERVED";
      reservedAt = new Date();
      expiresAt = new Date(
        reservedAt.getTime() + policy.reserveTtlHours * 3600 * 1000,
      );
      await recordMovement(
        tx,
        {
          quotaId: quota.id,
          dealId: input.dealId,
          type: "RESERVE",
          userId: input.userId ?? null,
        },
        orgId,
      );
    }

    const dealQuota = await tx.dealQuota.create({
      data: withOrg(
        {
          dealId: input.dealId,
          quotaId: quota.id,
          status,
          // Snapshot dos termos EFETIVOS (categoria sobrepõe cota).
          valueSnapshot: eff.discountValue,
          typeSnapshot: eff.discountType,
          reservedAt,
          expiresAt,
        },
        orgId,
      ),
      select: { id: true, status: true, reservedAt: true, expiresAt: true },
    });

    const snapshot = await refreshDealPriceSnapshots(tx, input.dealId);

    return {
      dealQuotaId: dealQuota.id,
      status: dealQuota.status,
      reservedAt: dealQuota.reservedAt,
      expiresAt: dealQuota.expiresAt,
      priceFullSnapshot: snapshot.full,
      priceFinalSnapshot: snapshot.final,
    };
  });
}

/**
 * Remove a cota do deal. Se estava RESERVED, devolve saldo (RN-07) e
 * marca `RETURNED`; se estava SELECTED, apenas marca `RETURNED` (nunca
 * consumiu). Se CONSUMED, também devolve o saldo (idempotente: só entra
 * aqui quando removeQuotaFromDeal é chamada explicitamente, ex.: erro
 * de cadastro. Cancelamento pós-ganho passa por `onDealReverted`).
 */
export async function removeQuotaFromDeal(input: {
  dealId: string;
  quotaId: string;
  userId?: string | null;
}): Promise<{ priceFullSnapshot: number; priceFinalSnapshot: number }> {
  const orgId = getOrgIdOrThrow();
  return prisma.$transaction(async (tx) => {
    const dq = await tx.dealQuota.findUnique({
      where: {
        dealId_quotaId: { dealId: input.dealId, quotaId: input.quotaId },
      },
      select: { id: true, status: true },
    });
    if (!dq) {
      throw new QuotaError(
        "COTA_NAO_VINCULADA",
        "Cota não está vinculada a este negócio.",
      );
    }
    if (dq.status === "RETURNED" || dq.status === "EXPIRED") {
      // Nada a fazer, mas segue recalculando snapshots para consistência.
      const snap = await refreshDealPriceSnapshots(tx, input.dealId);
      return { priceFullSnapshot: snap.full, priceFinalSnapshot: snap.final };
    }

    if (dq.status === "RESERVED" || dq.status === "CONSUMED") {
      await decrementConsumption(tx, input.quotaId, orgId);
      await recordMovement(
        tx,
        {
          quotaId: input.quotaId,
          dealId: input.dealId,
          type: "RETURN",
          userId: input.userId ?? null,
        },
        orgId,
      );
    }
    await tx.dealQuota.update({
      where: { id: dq.id },
      data: { status: "RETURNED" },
    });
    const snap = await refreshDealPriceSnapshots(tx, input.dealId);
    return { priceFullSnapshot: snap.full, priceFinalSnapshot: snap.final };
  });
}

/* ──────────────────────── RN-07: transições do deal ───────────────── */

/**
 * Consumo definitivo: chamado quando o deal é GANHO. SELECTED vira
 * CONSUMED (incrementa qtyConsumed atomicamente); RESERVED vira
 * CONSUMED (sem novo incremento — já foi contabilizado na reserva).
 *
 * Se algum SELECTED não puder ser consumido (esgotou entre a seleção e
 * o ganho), marca EXPIRED e devolve movimento; não derruba o ganho.
 */
export async function onDealWon(dealId: string): Promise<void> {
  const orgId = getOrgIdOrThrow();
  await prisma.$transaction(async (tx) => {
    const dqs = await tx.dealQuota.findMany({
      where: {
        dealId,
        status: { in: ["SELECTED", "RESERVED"] },
      },
      select: { id: true, quotaId: true, status: true },
    });
    for (const dq of dqs) {
      if (dq.status === "SELECTED") {
        const ok = await atomicallyIncrementConsumption(tx, dq.quotaId, orgId);
        if (!ok) {
          await tx.dealQuota.update({
            where: { id: dq.id },
            data: { status: "EXPIRED" },
          });
          await recordMovement(
            tx,
            {
              quotaId: dq.quotaId,
              dealId,
              type: "EXPIRE",
              reason: "Cota esgotada entre seleção e ganho.",
            },
            orgId,
          );
          continue;
        }
        await recordMovement(
          tx,
          { quotaId: dq.quotaId, dealId, type: "CONSUME" },
          orgId,
        );
      }
      // RESERVED: já consumiu na reserva. Só muda status.
      await tx.dealQuota.update({
        where: { id: dq.id },
        data: { status: "CONSUMED", expiresAt: null },
      });
    }
    await refreshDealPriceSnapshots(tx, dealId);
  });
}

/**
 * Reversão: chamado quando o deal é PERDIDO/reaberto. RESERVED devolve
 * saldo (decrementa qtyConsumed); CONSUMED devolve saldo (deal foi
 * revertido, precisa liberar o cupom). SELECTED nunca consumiu.
 *
 * Idempotente: repetir a chamada só faz sentido se ainda há status
 * ativo; após rodar, todas viram RETURNED.
 */
export async function onDealReverted(dealId: string): Promise<void> {
  const orgId = getOrgIdOrThrow();
  await prisma.$transaction(async (tx) => {
    const dqs = await tx.dealQuota.findMany({
      where: {
        dealId,
        status: { in: ["SELECTED", "RESERVED", "CONSUMED"] },
      },
      select: { id: true, quotaId: true, status: true },
    });
    for (const dq of dqs) {
      if (dq.status === "RESERVED" || dq.status === "CONSUMED") {
        await decrementConsumption(tx, dq.quotaId, orgId);
        await recordMovement(
          tx,
          {
            quotaId: dq.quotaId,
            dealId,
            type: "RETURN",
            reason: "Deal revertido/perdido",
          },
          orgId,
        );
      }
      await tx.dealQuota.update({
        where: { id: dq.id },
        data: { status: "RETURNED" },
      });
    }
    await refreshDealPriceSnapshots(tx, dealId);
  });
}

/* ────────────────────── Ajuste manual (RN-09 hook) ────────────────── */

export async function manualAdjust(input: {
  quotaId: string;
  delta: number;
  userId?: string | null;
  reason: string;
}): Promise<void> {
  if (input.delta === 0) throw new Error("quota.manualAdjust: delta = 0.");
  const orgId = getOrgIdOrThrow();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "discount_quotas"
      SET "qtyConsumed" = GREATEST("qtyConsumed" + ${input.delta}, 0),
          "updatedAt" = NOW()
      WHERE "id" = ${input.quotaId}
        AND "organizationId" = ${orgId};
    `;
    await recordMovement(
      tx,
      {
        quotaId: input.quotaId,
        type: "MANUAL_ADJUST",
        qty: Math.abs(input.delta),
        userId: input.userId ?? null,
        reason: input.reason,
      },
      orgId,
    );
  });
}

/* ────────────────────── Utilitário público (testes) ───────────────── */

// Reexporta o algoritmo puro para testes unitários (CA-08 usa direto).
export const __internal = {
  applyQuotasToPrice,
  assertStackable,
};
