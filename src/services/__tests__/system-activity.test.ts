import { describe, expect, it } from "vitest";

import {
  SYSTEM_ACTIVITY_IDLE_MS,
  SYSTEM_ACTIVITY_MIN_PULSE_MS,
  activityEnd,
  clampInteractionCount,
  overlapsWindow,
  shouldRenewSession,
  effectiveSessionEnd,
  intersectSeconds,
} from "@/services/system-activity";

describe("system-activity — regras puras", () => {
  const t0 = new Date("2026-07-26T12:00:00.000Z");

  it("expõe idle de 5 min e pulso mínimo de 30s", () => {
    expect(SYSTEM_ACTIVITY_IDLE_MS).toBe(5 * 60_000);
    expect(SYSTEM_ACTIVITY_MIN_PULSE_MS).toBe(30_000);
  });

  it("activityEnd = lastActivityAt + 5min", () => {
    expect(activityEnd(t0).getTime()).toBe(t0.getTime() + 5 * 60_000);
  });

  it("renova sessão quando ação ocorre dentro de 5min", () => {
    const at = new Date(t0.getTime() + 4 * 60_000);
    expect(shouldRenewSession(t0, at)).toBe(true);
  });

  it("não renova se ação chega depois de 5min exatos", () => {
    const at = new Date(t0.getTime() + 5 * 60_000 + 1);
    expect(shouldRenewSession(t0, at)).toBe(false);
  });

  it("renova no limite exato de 5min", () => {
    const at = new Date(t0.getTime() + 5 * 60_000);
    expect(shouldRenewSession(t0, at)).toBe(true);
  });

  it("overlapsWindow detecta sobreposição de sessão com janela", () => {
    const s = new Date("2026-07-26T10:00:00.000Z");
    const e = new Date("2026-07-26T11:00:00.000Z");
    const from = new Date("2026-07-26T10:30:00.000Z");
    const to = new Date("2026-07-26T11:30:00.000Z");
    expect(overlapsWindow(s, e, from, to)).toBe(true);
  });

  it("overlapsWindow retorna false quando sessão termina antes de from", () => {
    const s = new Date("2026-07-26T08:00:00.000Z");
    const e = new Date("2026-07-26T09:00:00.000Z");
    const from = new Date("2026-07-26T10:00:00.000Z");
    const to = new Date("2026-07-26T11:00:00.000Z");
    expect(overlapsWindow(s, e, from, to)).toBe(false);
  });

  it("clampInteractionCount limita 1..500", () => {
    expect(clampInteractionCount(0)).toBe(1);
    expect(clampInteractionCount(-5)).toBe(1);
    expect(clampInteractionCount(1)).toBe(1);
    expect(clampInteractionCount(250)).toBe(250);
    expect(clampInteractionCount(500)).toBe(500);
    expect(clampInteractionCount(9999)).toBe(500);
    expect(clampInteractionCount(1.7)).toBe(1);
    expect(clampInteractionCount(Number.NaN)).toBe(1);
  });

  it("effectiveSessionEnd: sessão fechada usa endedAt", () => {
    const s = new Date("2026-07-26T10:00:00.000Z");
    const ended = new Date("2026-07-26T10:30:00.000Z");
    const last = new Date("2026-07-26T10:25:00.000Z");
    const now = new Date("2026-07-26T12:00:00.000Z");
    const to = new Date("2026-07-26T13:00:00.000Z");
    expect(effectiveSessionEnd(s, last, ended, now, to).getTime()).toBe(
      ended.getTime(),
    );
  });

  it("effectiveSessionEnd: sessão aberta = min(lastActivity+5m, now, to)", () => {
    const s = new Date("2026-07-26T10:00:00.000Z");
    const last = new Date("2026-07-26T10:25:00.000Z");
    // lastActivity+5m = 10:30; now = 12:00; to = 13:00
    const now = new Date("2026-07-26T12:00:00.000Z");
    const to = new Date("2026-07-26T13:00:00.000Z");
    expect(effectiveSessionEnd(s, last, null, now, to).getTime()).toBe(
      last.getTime() + 5 * 60_000,
    );
  });

  it("effectiveSessionEnd: sessão aberta cortada por 'to'", () => {
    const s = new Date("2026-07-26T10:00:00.000Z");
    const last = new Date("2026-07-26T12:00:00.000Z");
    const now = new Date("2026-07-26T12:10:00.000Z");
    const to = new Date("2026-07-26T12:05:00.000Z");
    expect(effectiveSessionEnd(s, last, null, now, to).getTime()).toBe(
      to.getTime(),
    );
  });

  it("intersectSeconds corta início e fim pela janela", () => {
    const s = new Date("2026-07-26T09:00:00.000Z");
    const e = new Date("2026-07-26T12:00:00.000Z");
    const from = new Date("2026-07-26T10:00:00.000Z");
    const to = new Date("2026-07-26T11:00:00.000Z");
    expect(intersectSeconds(s, e, from, to)).toBe(3600);
  });

  it("intersectSeconds = 0 quando não sobrepõe", () => {
    const s = new Date("2026-07-26T09:00:00.000Z");
    const e = new Date("2026-07-26T09:30:00.000Z");
    const from = new Date("2026-07-26T10:00:00.000Z");
    const to = new Date("2026-07-26T11:00:00.000Z");
    expect(intersectSeconds(s, e, from, to)).toBe(0);
  });

  it("ação isolada representa janela máxima de 5 minutos", () => {
    // startedAt = lastActivityAt (uma ação isolada), fim = last+5m
    const last = t0;
    const ended = null;
    const now = new Date(t0.getTime() + 10 * 60_000);
    const to = new Date(t0.getTime() + 60 * 60_000);
    const end = effectiveSessionEnd(t0, last, ended, now, to);
    expect(end.getTime() - t0.getTime()).toBe(5 * 60_000);
  });
});
