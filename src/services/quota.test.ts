/**
 * Cotas de Desconto (PRD Cotas — Fase 1) — testes de unidade.
 *
 * Estratégia igual à do `inventory.test.ts`: pilha em memória que replica
 * o contrato do Prisma usado por `quota.ts` ($transaction, $queryRaw,
 * $executeRaw, findUnique/findMany/findFirst/create/update). Como o
 * núcleo consumo/return é UPDATE condicional via `$queryRaw`, o mock
 * respeita saldo/vigência do "banco" em memória, reproduzindo o
 * comportamento anti-overbooking (RN-06 / CA-06).
 *
 * Cobertura por critério de aceitação:
 *   CA-04  cálculo de preço em cascata vs soma simples
 *   CA-05  reserva ao atingir threshold da política
 *   CA-06  duas seleções concorrentes → só uma consome a última unidade
 *   CA-07  transição ganhar/reverter (SELECTED→CONSUMED, RESERVED→
 *           CONSUMED sem re-incrementar, ganho recomputa snapshot,
 *           reversão devolve saldo)
 *   CA-08  cumulatividade (grupo de exclusão + maxStacks)
 *   CA-10  expiração/return (removeQuotaFromDeal devolve saldo se
 *           reservada; snapshot recomputa)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type QuotaRow = {
  id: string;
  active: boolean;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  productId: string | null;
  orgUnitId: string | null;
  qtyTotal: number | null;
  qtyConsumed: number;
  validFrom: Date;
  validTo: Date | null;
  exclusionGroup: string | null;
  maxStacks: number;
  calcMode: "CASCADE" | "SUM_SIMPLE";
  organizationId: string;
};

type DealRow = {
  id: string;
  orgUnitId: string | null;
  priceFullSnapshot: number | null;
  priceFinalSnapshot: number | null;
};

type DealQuotaRow = {
  id: string;
  organizationId: string;
  dealId: string;
  quotaId: string;
  status: "SELECTED" | "RESERVED" | "CONSUMED" | "RETURNED" | "EXPIRED";
  valueSnapshot: number;
  typeSnapshot: "PERCENT" | "FIXED";
  reservedAt: Date | null;
  expiresAt: Date | null;
};

type MovementRow = {
  id: string;
  quotaId: string;
  dealId: string | null;
  type: "RESERVE" | "CONSUME" | "RETURN" | "EXPIRE" | "MANUAL_ADJUST";
  qty: number;
};

type PolicyRow = {
  id: string;
  organizationId: string;
  quotaId: string | null;
  consumeMoment: "ON_WIN" | "ON_RESERVE";
  reserveThreshold: number | null;
  reserveTtlHours: number;
  active: boolean;
};

type DealProductRow = { dealId: string; productId: string; quantity: number; unitPrice: number; discount: number };

const { store, prismaMock } = vi.hoisted(() => {
  const store: {
    quotas: Record<string, QuotaRow>;
    deals: Record<string, DealRow>;
    dealQuotas: DealQuotaRow[];
    movements: MovementRow[];
    policies: PolicyRow[];
    dealProducts: DealProductRow[];
    seq: number;
  } = {
    quotas: {},
    deals: {},
    dealQuotas: [],
    movements: [],
    policies: [],
    dealProducts: [],
    seq: 0,
  };

  const nextId = (prefix: string) => `${prefix}_${++store.seq}`;

  const num = (v: unknown): number => Number(v ?? 0);

  const isSameDayOrBefore = (a: Date, b: Date) => a.getTime() <= b.getTime();

  function matchesQuotaFilter(q: QuotaRow, args: Record<string, unknown>): boolean {
    if (args.active !== undefined && q.active !== args.active) return false;
    return true;
  }

  const prismaMock = {
    async $transaction<T>(fn: (tx: typeof prismaMock) => Promise<T>): Promise<T> {
      return fn(prismaMock);
    },
    // Simula os UPDATEs condicionais/RETURNING.
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> {
      const sql = strings.join("?");
      if (sql.includes("UPDATE \"discount_quotas\"")) {
        const quotaId = values[0] as string;
        const orgId = values[1] as string;
        const q = store.quotas[quotaId];
        if (!q || q.organizationId !== orgId || !q.active) return [];
        const now = new Date();
        if (q.validFrom > now) return [];
        if (q.validTo !== null && q.validTo < now) return [];
        if (q.qtyTotal !== null && q.qtyConsumed >= q.qtyTotal) return [];
        q.qtyConsumed += 1;
        return [{ id: q.id }];
      }
      return [];
    },
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> {
      const sql = strings.join("?");
      if (sql.includes("GREATEST(\"qtyConsumed\" - 1")) {
        const quotaId = values[0] as string;
        const orgId = values[1] as string;
        const q = store.quotas[quotaId];
        if (!q || q.organizationId !== orgId) return 0;
        q.qtyConsumed = Math.max(0, q.qtyConsumed - 1);
        return 1;
      }
      if (sql.includes("GREATEST(\"qtyConsumed\" + ")) {
        const delta = values[0] as number;
        const quotaId = values[1] as string;
        const orgId = values[2] as string;
        const q = store.quotas[quotaId];
        if (!q || q.organizationId !== orgId) return 0;
        q.qtyConsumed = Math.max(0, q.qtyConsumed + delta);
        return 1;
      }
      return 0;
    },
    discountQuota: {
      async findMany({ where }: { where: Record<string, unknown>; orderBy?: unknown; include?: unknown }) {
        return Object.values(store.quotas)
          .filter((q) => matchesQuotaFilter(q, where))
          .map((q) => ({ ...q, categoryId: null, category: null }));
      },
      async findUnique({ where }: { where: { id: string }; include?: unknown }) {
        const q = store.quotas[where.id];
        if (!q) return null;
        return { ...q, categoryId: null, category: null };
      },
    },
    quotaConsumptionPolicy: {
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return (
          store.policies.find((p) => {
            if (where.quotaId !== undefined && p.quotaId !== where.quotaId) return false;
            if (where.active !== undefined && p.active !== where.active) return false;
            if (where.organizationId && p.organizationId !== where.organizationId) return false;
            return true;
          }) ?? null
        );
      },
    },
    dealQuota: {
      async findMany({ where }: { where: Record<string, unknown>; select?: unknown; include?: unknown }) {
        const statuses = ((where.status as { in?: string[] } | undefined)?.in) ?? null;
        return store.dealQuotas
          .filter((dq) => {
            if (where.dealId && dq.dealId !== where.dealId) return false;
            if (statuses && !statuses.includes(dq.status)) return false;
            return true;
          })
          .map((dq) => {
            const q = store.quotas[dq.quotaId];
            return {
              ...dq,
              // O service pode consultar tanto o shape completo (include)
              // quanto o compacto (select) — devolvemos o superconjunto
              // + `category: null` (nenhum teste usa categorias).
              quota: q
                ? { ...q, categoryId: null, category: null }
                : {
                    id: dq.quotaId,
                    exclusionGroup: null,
                    maxStacks: 1,
                    calcMode: "CASCADE",
                    categoryId: null,
                    category: null,
                  },
            };
          });
      },
      async findUnique({ where }: { where: { dealId_quotaId: { dealId: string; quotaId: string } } }) {
        const { dealId, quotaId } = where.dealId_quotaId;
        return (
          store.dealQuotas.find((dq) => dq.dealId === dealId && dq.quotaId === quotaId) ?? null
        );
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row: DealQuotaRow = {
          id: nextId("dq"),
          organizationId: data.organizationId as string,
          dealId: data.dealId as string,
          quotaId: data.quotaId as string,
          status: (data.status as DealQuotaRow["status"]) ?? "SELECTED",
          valueSnapshot: num(data.valueSnapshot),
          typeSnapshot: data.typeSnapshot as "PERCENT" | "FIXED",
          reservedAt: (data.reservedAt as Date | null) ?? null,
          expiresAt: (data.expiresAt as Date | null) ?? null,
        };
        store.dealQuotas.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const dq = store.dealQuotas.find((d) => d.id === where.id);
        if (!dq) throw new Error("not found");
        Object.assign(dq, data);
        return dq;
      },
    },
    quotaMovement: {
      async create({ data }: { data: Record<string, unknown> }) {
        const row: MovementRow = {
          id: nextId("mv"),
          quotaId: data.quotaId as string,
          dealId: (data.dealId as string | null) ?? null,
          type: data.type as MovementRow["type"],
          qty: (data.qty as number) ?? 1,
        };
        store.movements.push(row);
        return row;
      },
    },
    deal: {
      async findUnique({ where }: { where: { id: string } }) {
        const d = store.deals[where.id];
        if (!d) return null;
        return {
          ...d,
          products: store.dealProducts
            .filter((p) => p.dealId === d.id)
            .map((p) => ({ productId: p.productId })),
        };
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const d = store.deals[where.id];
        if (!d) throw new Error("deal not found");
        if (data.priceFullSnapshot !== undefined) d.priceFullSnapshot = Number(data.priceFullSnapshot);
        if (data.priceFinalSnapshot !== undefined)
          d.priceFinalSnapshot = Number(data.priceFinalSnapshot);
        return d;
      },
    },
    dealProduct: {
      async findMany({ where }: { where: { dealId: string } }) {
        return store.dealProducts.filter((p) => p.dealId === where.dealId);
      },
    },
  };

  return { store, prismaMock };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/request-context", () => ({ getOrgIdOrThrow: () => "org_test" }));
vi.mock("@/lib/prisma-helpers", () => ({
  withOrg: (data: Record<string, unknown>, orgId: string) => ({
    ...data,
    organizationId: orgId,
  }),
}));

import { Prisma } from "@prisma/client";

import {
  QuotaError,
  QuotaExhaustedError,
  QuotaNotStackableError,
  __internal,
  onDealReverted,
  onDealWon,
  removeQuotaFromDeal,
  selectQuotaForDeal,
} from "@/services/quota";

function seedQuota(input: Partial<QuotaRow> & { id: string }): void {
  const now = new Date();
  store.quotas[input.id] = {
    id: input.id,
    active: true,
    discountType: "PERCENT",
    discountValue: 10,
    productId: null,
    orgUnitId: null,
    qtyTotal: null,
    qtyConsumed: 0,
    validFrom: now,
    validTo: null,
    exclusionGroup: null,
    maxStacks: 1,
    calcMode: "CASCADE",
    organizationId: "org_test",
    ...input,
  };
}

function seedDeal(id: string, opts: { orgUnitId?: string | null; products?: string[] } = {}): void {
  store.deals[id] = {
    id,
    orgUnitId: opts.orgUnitId ?? null,
    priceFullSnapshot: null,
    priceFinalSnapshot: null,
  };
  if (opts.products) {
    for (const productId of opts.products) {
      store.dealProducts.push({
        dealId: id,
        productId,
        quantity: 1,
        unitPrice: 1000,
        discount: 0,
      });
    }
  }
}

beforeEach(() => {
  store.quotas = {};
  store.deals = {};
  store.dealQuotas = [];
  store.movements = [];
  store.policies = [];
  store.dealProducts = [];
  store.seq = 0;
});

/* ────────────── CA-04: cálculo de preço ────────────── */

describe("CA-04 applyQuotasToPrice", () => {
  it("cascade: aplica percentuais em ordem decrescente e depois fixos", () => {
    const price = __internal.applyQuotasToPrice(new Prisma.Decimal(1000), [
      { discountType: "PERCENT", discountValue: new Prisma.Decimal(20), calcMode: "CASCADE" },
      { discountType: "PERCENT", discountValue: new Prisma.Decimal(10), calcMode: "CASCADE" },
      { discountType: "FIXED", discountValue: new Prisma.Decimal(50), calcMode: "CASCADE" },
    ]);
    // 1000 * 0.8 = 800; 800 * 0.9 = 720; 720 - 50 = 670
    expect(Number(price)).toBe(670);
  });

  it("sum_simple: soma dos percentuais uma única vez + soma dos fixos", () => {
    const price = __internal.applyQuotasToPrice(new Prisma.Decimal(1000), [
      { discountType: "PERCENT", discountValue: new Prisma.Decimal(20), calcMode: "SUM_SIMPLE" },
      { discountType: "PERCENT", discountValue: new Prisma.Decimal(10), calcMode: "SUM_SIMPLE" },
      { discountType: "FIXED", discountValue: new Prisma.Decimal(50), calcMode: "SUM_SIMPLE" },
    ]);
    // 1000 * (1 - 0.3) = 700; 700 - 50 = 650
    expect(Number(price)).toBe(650);
  });

  it("mix de modos força CASCADE (mais conservador)", () => {
    const price = __internal.applyQuotasToPrice(new Prisma.Decimal(1000), [
      { discountType: "PERCENT", discountValue: new Prisma.Decimal(20), calcMode: "CASCADE" },
      { discountType: "PERCENT", discountValue: new Prisma.Decimal(10), calcMode: "SUM_SIMPLE" },
    ]);
    // cascade → 1000*0.8*0.9 = 720
    expect(Number(price)).toBe(720);
  });

  it("nunca abaixo de zero", () => {
    const price = __internal.applyQuotasToPrice(new Prisma.Decimal(100), [
      { discountType: "FIXED", discountValue: new Prisma.Decimal(500), calcMode: "SUM_SIMPLE" },
    ]);
    expect(Number(price)).toBe(0);
  });
});

/* ────────────── CA-08: cumulatividade ────────────── */

describe("CA-08 assertStackable", () => {
  it("grupo de exclusão bloqueia mesma família", () => {
    expect(() =>
      __internal.assertStackable(
        [{ quotaId: "a", exclusionGroup: "bolsas", maxStacks: 5 }],
        { quotaId: "b", exclusionGroup: "bolsas", maxStacks: 5 },
      ),
    ).toThrow(QuotaNotStackableError);
  });

  it("maxStacks=1 na candidata bloqueia acúmulo", () => {
    expect(() =>
      __internal.assertStackable(
        [{ quotaId: "a", exclusionGroup: null, maxStacks: 3 }],
        { quotaId: "b", exclusionGroup: null, maxStacks: 1 },
      ),
    ).toThrow(QuotaNotStackableError);
  });

  it("respeita o min(maxStacks) do conjunto", () => {
    expect(() =>
      __internal.assertStackable(
        [
          { quotaId: "a", exclusionGroup: null, maxStacks: 2 },
          { quotaId: "b", exclusionGroup: null, maxStacks: 3 },
        ],
        { quotaId: "c", exclusionGroup: null, maxStacks: 5 },
      ),
    ).toThrow(QuotaNotStackableError);
  });

  it("aceita quando grupos diferentes e maxStacks suficiente", () => {
    expect(() =>
      __internal.assertStackable(
        [{ quotaId: "a", exclusionGroup: "bolsa", maxStacks: 3 }],
        { quotaId: "b", exclusionGroup: "estudante", maxStacks: 3 },
      ),
    ).not.toThrow();
  });
});

/* ────────────── CA-05: reserva por threshold ────────────── */

describe("CA-05 reserve threshold policy", () => {
  it("saldo <= threshold e ON_WIN por default → reserva imediata (consome atomicamente)", async () => {
    seedQuota({ id: "q1", qtyTotal: 3, qtyConsumed: 1 }); // saldo 2
    seedDeal("d1");
    store.policies.push({
      id: "p1",
      organizationId: "org_test",
      quotaId: "q1",
      consumeMoment: "ON_WIN",
      reserveThreshold: 2,
      reserveTtlHours: 24,
      active: true,
    });

    const res = await selectQuotaForDeal({ dealId: "d1", quotaId: "q1" });
    expect(res.status).toBe("RESERVED");
    expect(res.reservedAt).not.toBeNull();
    expect(res.expiresAt).not.toBeNull();
    // Consumo atômico decrementou saldo
    expect(store.quotas.q1.qtyConsumed).toBe(2);
    // Ledger recebeu RESERVE
    expect(store.movements.filter((m) => m.type === "RESERVE")).toHaveLength(1);
  });

  it("saldo > threshold → SELECTED sem consumo", async () => {
    seedQuota({ id: "q1", qtyTotal: 10, qtyConsumed: 1 });
    seedDeal("d1");
    store.policies.push({
      id: "p1",
      organizationId: "org_test",
      quotaId: "q1",
      consumeMoment: "ON_WIN",
      reserveThreshold: 2,
      reserveTtlHours: 24,
      active: true,
    });

    const res = await selectQuotaForDeal({ dealId: "d1", quotaId: "q1" });
    expect(res.status).toBe("SELECTED");
    expect(store.quotas.q1.qtyConsumed).toBe(1); // sem alteração
    expect(store.movements).toHaveLength(0);
  });
});

/* ────────────── CA-06: concorrência ────────────── */

describe("CA-06 atomic consumption (última unidade)", () => {
  it("duas seleções concorrentes com política ON_RESERVE → só uma vence", async () => {
    seedQuota({ id: "q1", qtyTotal: 1, qtyConsumed: 0 });
    seedDeal("d1");
    seedDeal("d2");
    store.policies.push({
      id: "p1",
      organizationId: "org_test",
      quotaId: "q1",
      consumeMoment: "ON_RESERVE",
      reserveThreshold: null,
      reserveTtlHours: 24,
      active: true,
    });

    const results = await Promise.allSettled([
      selectQuotaForDeal({ dealId: "d1", quotaId: "q1" }),
      selectQuotaForDeal({ dealId: "d2", quotaId: "q1" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      QuotaExhaustedError,
    );
    expect(store.quotas.q1.qtyConsumed).toBe(1);
  });
});

/* ────────────── CA-07: ganho/reversão ────────────── */

describe("CA-07 onDealWon/onDealReverted", () => {
  it("onDealWon: SELECTED vira CONSUMED e incrementa saldo", async () => {
    seedQuota({ id: "q1", qtyTotal: 5, qtyConsumed: 0 });
    seedDeal("d1");
    // Simula uma seleção sem reserva (política default embutida).
    await selectQuotaForDeal({ dealId: "d1", quotaId: "q1" });
    expect(store.quotas.q1.qtyConsumed).toBe(0);
    expect(store.dealQuotas[0].status).toBe("SELECTED");

    await onDealWon("d1");
    expect(store.quotas.q1.qtyConsumed).toBe(1);
    expect(store.dealQuotas[0].status).toBe("CONSUMED");
    expect(store.movements.some((m) => m.type === "CONSUME")).toBe(true);
  });

  it("onDealWon: RESERVED vira CONSUMED SEM incrementar (já consumiu na reserva)", async () => {
    seedQuota({ id: "q1", qtyTotal: 1, qtyConsumed: 0 });
    seedDeal("d1");
    store.policies.push({
      id: "p1",
      organizationId: "org_test",
      quotaId: "q1",
      consumeMoment: "ON_RESERVE",
      reserveThreshold: null,
      reserveTtlHours: 24,
      active: true,
    });
    await selectQuotaForDeal({ dealId: "d1", quotaId: "q1" });
    expect(store.quotas.q1.qtyConsumed).toBe(1);

    await onDealWon("d1");
    expect(store.quotas.q1.qtyConsumed).toBe(1); // NÃO incrementou de novo
    expect(store.dealQuotas[0].status).toBe("CONSUMED");
  });

  it("onDealReverted: devolve saldo de RESERVED/CONSUMED e marca RETURNED", async () => {
    seedQuota({ id: "q1", qtyTotal: 2, qtyConsumed: 0 });
    seedDeal("d1");
    store.policies.push({
      id: "p1",
      organizationId: "org_test",
      quotaId: "q1",
      consumeMoment: "ON_RESERVE",
      reserveThreshold: null,
      reserveTtlHours: 24,
      active: true,
    });
    await selectQuotaForDeal({ dealId: "d1", quotaId: "q1" });
    await onDealWon("d1");
    expect(store.quotas.q1.qtyConsumed).toBe(1);

    await onDealReverted("d1");
    expect(store.quotas.q1.qtyConsumed).toBe(0);
    expect(store.dealQuotas[0].status).toBe("RETURNED");
  });
});

/* ────────────── CA-10: remoção manual devolve saldo ────────────── */

describe("CA-10 removeQuotaFromDeal", () => {
  it("cota RESERVED removida devolve saldo e marca RETURNED", async () => {
    seedQuota({ id: "q1", qtyTotal: 3, qtyConsumed: 0 });
    seedDeal("d1");
    store.policies.push({
      id: "p1",
      organizationId: "org_test",
      quotaId: "q1",
      consumeMoment: "ON_RESERVE",
      reserveThreshold: null,
      reserveTtlHours: 24,
      active: true,
    });
    await selectQuotaForDeal({ dealId: "d1", quotaId: "q1" });
    expect(store.quotas.q1.qtyConsumed).toBe(1);

    await removeQuotaFromDeal({ dealId: "d1", quotaId: "q1" });
    expect(store.quotas.q1.qtyConsumed).toBe(0);
    expect(store.dealQuotas[0].status).toBe("RETURNED");
    expect(store.movements.some((m) => m.type === "RETURN")).toBe(true);
  });

  it("cota SELECTED removida NÃO altera saldo", async () => {
    seedQuota({ id: "q1", qtyTotal: 3, qtyConsumed: 0 });
    seedDeal("d1");
    await selectQuotaForDeal({ dealId: "d1", quotaId: "q1" });
    expect(store.quotas.q1.qtyConsumed).toBe(0);

    await removeQuotaFromDeal({ dealId: "d1", quotaId: "q1" });
    expect(store.quotas.q1.qtyConsumed).toBe(0);
    expect(store.dealQuotas[0].status).toBe("RETURNED");
  });

  it("remover cota não vinculada lança COTA_NAO_VINCULADA", async () => {
    seedQuota({ id: "q1" });
    seedDeal("d1");
    await expect(
      removeQuotaFromDeal({ dealId: "d1", quotaId: "q1" }),
    ).rejects.toBeInstanceOf(QuotaError);
  });
});
