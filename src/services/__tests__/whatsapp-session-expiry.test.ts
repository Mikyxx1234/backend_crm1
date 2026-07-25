import { describe, expect, it } from "vitest";

import {
  buildSessionExpiryClaimKey,
  getSessionExpiryWindow,
  normalizeHoursBeforeExpiry,
} from "@/services/whatsapp-session-expiry";

describe("WhatsApp session expiry", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");

  it("seleciona somente sessão aberta que expira dentro do horizonte", () => {
    const inside = getSessionExpiryWindow(
      new Date("2026-07-24T13:00:00.000Z"),
      2,
      now,
    );
    const outside = getSessionExpiryWindow(
      new Date("2026-07-24T15:00:00.000Z"),
      2,
      now,
    );
    const expired = getSessionExpiryWindow(
      new Date("2026-07-24T11:59:59.000Z"),
      2,
      now,
    );

    expect(inside?.sessionExpiresAt.toISOString()).toBe("2026-07-25T13:00:00.000Z");
    expect(outside).toBeNull();
    expect(expired).toBeNull();
  });

  it("normaliza apenas horas maiores que zero e menores que 24", () => {
    expect(normalizeHoursBeforeExpiry(6)).toBe(6);
    expect(normalizeHoursBeforeExpiry("2.5")).toBe(2.5);
    expect(normalizeHoursBeforeExpiry(0)).toBeNull();
    expect(normalizeHoursBeforeExpiry(24)).toBeNull();
    expect(normalizeHoursBeforeExpiry("x")).toBeNull();
  });

  it("mantém a claim estável no mesmo inbound e muda em uma nova janela", () => {
    const first = new Date("2026-07-24T13:00:00.000Z");
    const next = new Date("2026-07-25T13:00:00.000Z");

    expect(buildSessionExpiryClaimKey("auto", "contact", "channel", first)).toBe(
      buildSessionExpiryClaimKey("auto", "contact", "channel", first),
    );
    expect(buildSessionExpiryClaimKey("auto", "contact", "channel", first)).not.toBe(
      buildSessionExpiryClaimKey("auto", "contact", "channel", next),
    );
  });
});
