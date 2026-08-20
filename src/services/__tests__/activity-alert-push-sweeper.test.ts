/**
 * O sweeper roda fora de request, entao cada usuario precisa ser processado
 * dentro de withSystemContext — sem isso o prisma com escopo de tenant lanca
 * e ninguem recebe aviso com o app fechado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { subs, contexts, getNextActivityAlert } = vi.hoisted(() => ({
  subs: [] as Array<{ userId: string; organizationId: string }>,
  contexts: [] as string[],
  getNextActivityAlert: vi.fn(async () => null),
}));

vi.mock("@/lib/prisma-base", () => ({
  prismaBase: {
    webPushSubscription: {
      findMany: vi.fn(async () => subs),
    },
  },
}));

vi.mock("@/lib/webhook-context", () => ({
  withSystemContext: vi.fn(
    async (organizationId: string, handler: () => unknown) => {
      contexts.push(organizationId);
      return handler();
    },
  ),
}));

vi.mock("@/services/activity-alerts", () => ({ getNextActivityAlert }));

import { sweepActivityAlertPushes } from "@/services/activity-alert-push-sweeper";

beforeEach(() => {
  subs.length = 0;
  contexts.length = 0;
  getNextActivityAlert.mockReset();
  getNextActivityAlert.mockResolvedValue(null);
});

describe("sweepActivityAlertPushes", () => {
  it("processa cada usuario dentro do contexto da sua organizacao", async () => {
    subs.push(
      { userId: "u1", organizationId: "org-1" },
      { userId: "u2", organizationId: "org-2" },
    );

    const result = await sweepActivityAlertPushes();

    expect(result.users).toBe(2);
    expect(contexts).toEqual(["org-1", "org-2"]);
    expect(getNextActivityAlert).toHaveBeenCalledWith("u1", "org-1");
    expect(getNextActivityAlert).toHaveBeenCalledWith("u2", "org-2");
  });

  it("falha de um usuario nao interrompe os demais", async () => {
    subs.push(
      { userId: "u1", organizationId: "org-1" },
      { userId: "u2", organizationId: "org-2" },
    );
    getNextActivityAlert.mockRejectedValueOnce(new Error("fora de contexto"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await sweepActivityAlertPushes();

    expect(result.users).toBe(2);
    expect(getNextActivityAlert).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
