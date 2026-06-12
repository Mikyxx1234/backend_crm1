/**
 * Testes do núcleo crítico de alocação consumível (`inventory.ts`).
 *
 * Estratégia: ledger em memória que reproduz o contrato do Prisma usado pelo
 * serviço (aggregate/groupBy/create + $queryRaw do lock + $transaction). Como o
 * serviço deriva o saldo de `sum(delta)` e protege a última unidade com o lock
 * pessimista, conseguimos validar a lógica de saldo, recusa sem estoque,
 * reserva/liberação e estorno sem depender de um Postgres real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, prismaMock } = vi.hoisted(() => {
  const store: {
    movements: Array<{
      id: string;
      poolId: string;
      delta: number;
      reason: string;
      dealId: string | null;
    }>;
    pools: Record<string, { allowNegative: boolean }>;
    seq: number;
  } = { movements: [], pools: {}, seq: 0 };

  const prismaMock: {
    $transaction: <T>(fn: (tx: typeof prismaMock) => Promise<T>) => Promise<T>;
    $queryRaw: (...args: unknown[]) => Promise<unknown>;
    inventoryMovement: {
      aggregate: (args: { where: { poolId: string } }) => Promise<{ _sum: { delta: number } }>;
      groupBy: (args: {
        by: string[];
        where: { poolId?: string; dealId?: string };
      }) => Promise<Array<Record<string, unknown>>>;
      create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    };
  } = {
    async $transaction(fn) {
      return fn(prismaMock);
    },
    async $queryRaw(...values: unknown[]) {
      // tagged template: values[0] = strings, values[1] = poolId, values[2] = orgId
      const poolId = values[1] as string;
      const cfg = store.pools[poolId];
      if (!cfg) return [];
      return [{ id: poolId, allowNegative: cfg.allowNegative }];
    },
    inventoryMovement: {
      async aggregate({ where }) {
        const sum = store.movements
          .filter((m) => m.poolId === where.poolId)
          .reduce((a, m) => a + m.delta, 0);
        return { _sum: { delta: sum } };
      },
      async groupBy({ by, where }) {
        const filtered = store.movements.filter((m) => {
          if (where.poolId != null && m.poolId !== where.poolId) return false;
          if (where.dealId != null && m.dealId !== where.dealId) return false;
          return true;
        });
        const key = by[0] as "poolId" | "reason";
        const groups = new Map<string, number>();
        for (const m of filtered) {
          const k = String((m as Record<string, unknown>)[key]);
          groups.set(k, (groups.get(k) ?? 0) + m.delta);
        }
        return [...groups.entries()].map(([k, delta]) => ({
          [key]: k,
          _sum: { delta },
        }));
      },
      async create({ data }) {
        store.seq += 1;
        const id = `mv_${store.seq}`;
        store.movements.push({
          id,
          poolId: data.poolId as string,
          delta: data.delta as number,
          reason: data.reason as string,
          dealId: (data.dealId as string | null) ?? null,
        });
        return { id };
      },
    },
  };

  return { store, prismaMock };
});

function seedPool(poolId: string, allowNegative = false) {
  store.pools[poolId] = { allowNegative };
}

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/request-context", () => ({ getOrgIdOrThrow: () => "org_test" }));
vi.mock("@/services/activity-log", () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma-helpers", () => ({
  withOrg: (data: Record<string, unknown>, orgId: string) => ({
    ...data,
    organizationId: orgId,
  }),
}));

import {
  InsufficientInventoryError,
  consume,
  getBalance,
  getPoolStats,
  release,
  reserve,
  restock,
  reverse,
} from "@/services/inventory";

beforeEach(() => {
  store.movements = [];
  store.pools = {};
  store.seq = 0;
});

describe("inventory ledger", () => {
  it("restock soma saldo e consume subtrai", async () => {
    seedPool("p1");
    await restock({ poolId: "p1", qty: 30, note: "inicial" });
    expect(await getBalance("p1")).toBe(30);

    const r = await consume({ poolId: "p1", qty: 5 });
    expect(r.balance).toBe(25);
    expect(await getBalance("p1")).toBe(25);
  });

  it("recusa consumo sem saldo quando allowNegative=false (protege última unidade)", async () => {
    seedPool("p1", false);
    await restock({ poolId: "p1", qty: 1, note: "1 vaga" });

    // 1º consumo leva a última unidade
    await consume({ poolId: "p1", qty: 1, reason: "HIRE" });
    // 2º consumo deve ser bloqueado
    await expect(consume({ poolId: "p1", qty: 1, reason: "HIRE" })).rejects.toBeInstanceOf(
      InsufficientInventoryError,
    );
    expect(await getBalance("p1")).toBe(0);
  });

  it("permite negativo quando allowNegative=true", async () => {
    seedPool("p1", true);
    await restock({ poolId: "p1", qty: 1, note: "1" });
    const r = await consume({ poolId: "p1", qty: 5 });
    expect(r.balance).toBe(-4);
  });

  it("reserve reduz saldo e release devolve", async () => {
    seedPool("p1");
    await restock({ poolId: "p1", qty: 10, note: "10" });
    await reserve({ poolId: "p1", qty: 3 });
    expect(await getBalance("p1")).toBe(7);

    await release({ poolId: "p1", qty: 3 });
    expect(await getBalance("p1")).toBe(10);
  });

  it("reserve recusa quando excede saldo", async () => {
    seedPool("p1");
    await restock({ poolId: "p1", qty: 2, note: "2" });
    await expect(reserve({ poolId: "p1", qty: 5 })).rejects.toBeInstanceOf(
      InsufficientInventoryError,
    );
  });

  it("reverse(dealId) restaura o saldo líquido do deal", async () => {
    seedPool("p1");
    await restock({ poolId: "p1", qty: 30, note: "30" });
    await consume({ poolId: "p1", qty: 4, dealId: "deal1", reason: "HIRE" });
    expect(await getBalance("p1")).toBe(26);

    const res = await reverse("deal1");
    expect(res.reversedPools).toBe(1);
    expect(await getBalance("p1")).toBe(30);

    // Idempotente: net do deal já é zero → no-op.
    const again = await reverse("deal1");
    expect(again.reversedPools).toBe(0);
    expect(await getBalance("p1")).toBe(30);
  });

  it("getPoolStats classifica capacity/reserved/consumed", async () => {
    seedPool("p1");
    await restock({ poolId: "p1", qty: 30, note: "30" });
    await reserve({ poolId: "p1", qty: 5 });
    await consume({ poolId: "p1", qty: 4, reason: "HIRE" });

    const stats = await getPoolStats("p1");
    expect(stats.capacity).toBe(30);
    expect(stats.reserved).toBe(5);
    expect(stats.consumed).toBe(4);
    expect(stats.balance).toBe(21);
  });

  it("consumo sequencial de 30 vagas: 31º é bloqueado", async () => {
    seedPool("p1", false);
    await restock({ poolId: "p1", qty: 30, note: "30 vagas" });
    for (let i = 0; i < 30; i++) {
      await consume({ poolId: "p1", qty: 1, reason: "HIRE", dealId: `c${i}` });
    }
    expect(await getBalance("p1")).toBe(0);
    await expect(
      consume({ poolId: "p1", qty: 1, reason: "HIRE", dealId: "c30" }),
    ).rejects.toBeInstanceOf(InsufficientInventoryError);
  });
});
