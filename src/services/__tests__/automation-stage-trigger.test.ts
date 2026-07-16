/**
 * Testes do matcher `stage_changed` do motor de automações.
 *
 * `evaluateTrigger` é função pura (sem prisma/contexto), então testamos o
 * casamento config × payload direto. Cobre a correção do alias `stageId`
 * como `toStageId` — telas de funil/pipeline salvam a etapa-alvo em
 * `stageId`, e antes disso o gatilho "quando entra na fase X" não casava.
 */
import { describe, expect, it } from "vitest";

import { evaluateTrigger } from "@/services/automations";

function ctx(data: Record<string, unknown>) {
  return { event: "stage_changed", data } as const;
}

describe("evaluateTrigger — stage_changed", () => {
  it("sem config: qualquer mudança de fase dispara", () => {
    expect(
      evaluateTrigger("stage_changed", {}, ctx({ fromStageId: "a", toStageId: "b" })),
    ).toBe(true);
  });

  it("toStageId no config casa com toStageId do payload", () => {
    expect(
      evaluateTrigger("stage_changed", { toStageId: "b" }, ctx({ fromStageId: "a", toStageId: "b" })),
    ).toBe(true);
  });

  it("toStageId no config diverge → não dispara", () => {
    expect(
      evaluateTrigger("stage_changed", { toStageId: "z" }, ctx({ fromStageId: "a", toStageId: "b" })),
    ).toBe(false);
  });

  it("alias stageId (config) é tratado como toStageId", () => {
    expect(
      evaluateTrigger("stage_changed", { stageId: "b" }, ctx({ fromStageId: "a", toStageId: "b" })),
    ).toBe(true);
    expect(
      evaluateTrigger("stage_changed", { stageId: "z" }, ctx({ fromStageId: "a", toStageId: "b" })),
    ).toBe(false);
  });

  it("alias stageId no payload casa com toStageId do config", () => {
    expect(
      evaluateTrigger("stage_changed", { toStageId: "b" }, ctx({ stageId: "b" })),
    ).toBe(true);
  });

  it("fromStageId no config filtra pela origem", () => {
    expect(
      evaluateTrigger("stage_changed", { fromStageId: "a" }, ctx({ fromStageId: "a", toStageId: "b" })),
    ).toBe(true);
    expect(
      evaluateTrigger("stage_changed", { fromStageId: "x" }, ctx({ fromStageId: "a", toStageId: "b" })),
    ).toBe(false);
  });

  it("from + to combinados: ambos precisam casar", () => {
    const cfg = { fromStageId: "a", toStageId: "b" };
    expect(evaluateTrigger("stage_changed", cfg, ctx({ fromStageId: "a", toStageId: "b" }))).toBe(true);
    expect(evaluateTrigger("stage_changed", cfg, ctx({ fromStageId: "a", toStageId: "c" }))).toBe(false);
    expect(evaluateTrigger("stage_changed", cfg, ctx({ fromStageId: "x", toStageId: "b" }))).toBe(false);
  });
});
