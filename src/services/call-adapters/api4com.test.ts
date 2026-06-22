/**
 * Testes do adapter Api4com — funções puras (normalize + extractCrmMetadata).
 *
 * Cobertura:
 *  - channel-answer → status ANSWERED, eventKind ANSWERED
 *  - channel-hangup com duration > 0 → COMPLETED + duration preservado
 *  - hangup com NO_ANSWER → MISSED
 *  - hangup com USER_BUSY → BUSY
 *  - hangup com FAILURE → FAILED
 *  - extractCrmMetadata aceita snake_case (default) e camelCase (defensivo)
 *  - timestamp em formato "2026-01-01 00:00:00" é parseado corretamente
 *  - id ausente → throw
 */
import { describe, expect, it } from "vitest";

import type { CallProviderConfig } from "@prisma/client";

import { api4comAdapter, extractCrmMetadata } from "./api4com";

const CONFIG = { providerKey: "api4com" } as unknown as CallProviderConfig;

describe("api4comAdapter.normalize", () => {
  it("channel-answer mapeia para status ANSWERED e eventKind ANSWERED", () => {
    const evt = api4comAdapter.normalize(
      {
        id: "call-1",
        eventType: "channel-answer",
        direction: "outbound",
        caller: "+5511988887777",
        called: "+5511955554444",
        startedAt: "2026-01-01 12:00:00",
        answeredAt: "2026-01-01 12:00:05",
        metadata: { gateway: "crm-org-1", deal_id: "deal-1" },
      },
      CONFIG,
    );

    expect(evt.status).toBe("ANSWERED");
    expect(evt.eventKind).toBe("ANSWERED");
    // Timestamp parseado como ISO 8601 (offset depende do TZ do server quando
    // a string vem sem `Z`). Verificamos só o instante coerente (mesmo dia).
    expect(evt.timestamp).toMatch(/^2026-01-01T/);
    expect(evt.crmMetadata?.dealId).toBe("deal-1");
  });

  it("channel-hangup com duration > 0 → COMPLETED e duration preservado", () => {
    const evt = api4comAdapter.normalize(
      {
        id: "call-2",
        eventType: "channel-hangup",
        direction: "outbound",
        caller: "1001",
        called: "+5511988887777",
        startedAt: "2026-01-01 12:00:00",
        answeredAt: "2026-01-01 12:00:05",
        endedAt: "2026-01-01 12:01:35",
        duration: 90,
        hangupCause: "NORMAL_CLEARING",
        recordUrl: "https://api4com.example/rec/123.mp3",
      },
      CONFIG,
    );

    expect(evt.status).toBe("COMPLETED");
    expect(evt.eventKind).toBe("HANGUP");
    expect(evt.durationSeconds).toBe(90);
    expect(evt.recordingUrl).toBe("https://api4com.example/rec/123.mp3");
    expect(evt.hangupCause).toBe("NORMAL_CLEARING");
  });

  it("hangup sem answer e cause NO_ANSWER → MISSED", () => {
    const evt = api4comAdapter.normalize(
      {
        id: "call-3",
        eventType: "channel-hangup",
        direction: "outbound",
        caller: "1001",
        called: "+5511988887777",
        startedAt: "2026-01-01 12:00:00",
        endedAt: "2026-01-01 12:00:30",
        duration: 0,
        hangupCause: "NO_ANSWER",
      },
      CONFIG,
    );

    expect(evt.status).toBe("MISSED");
  });

  it("hangup com USER_BUSY → BUSY", () => {
    const evt = api4comAdapter.normalize(
      {
        id: "call-4",
        eventType: "channel-hangup",
        direction: "outbound",
        caller: "1001",
        called: "+5511988887777",
        startedAt: "2026-01-01 12:00:00",
        endedAt: "2026-01-01 12:00:05",
        duration: 0,
        hangupCause: "USER_BUSY",
      },
      CONFIG,
    );

    expect(evt.status).toBe("BUSY");
  });

  it("hangup com FAILURE → FAILED", () => {
    const evt = api4comAdapter.normalize(
      {
        id: "call-5",
        eventType: "channel-hangup",
        direction: "outbound",
        caller: "1001",
        called: "+5511988887777",
        startedAt: "2026-01-01 12:00:00",
        answeredAt: "2026-01-01 12:00:05",
        endedAt: "2026-01-01 12:00:10",
        duration: 5,
        hangupCause: "INTERWORKING_FAILURE",
      },
      CONFIG,
    );

    expect(evt.status).toBe("FAILED");
  });

  it("aceita versão '1.8' e 'v1.4' transparentemente", () => {
    const v18 = api4comAdapter.normalize(
      { id: "x", eventType: "channel-hangup", version: "1.8", duration: 1, answeredAt: "2026-01-01 00:00:00", endedAt: "2026-01-01 00:00:01" },
      CONFIG,
    );
    const v14 = api4comAdapter.normalize(
      { id: "y", eventType: "channel-hangup", version: "v1.4", duration: 1, answeredAt: "2026-01-01 00:00:00", endedAt: "2026-01-01 00:00:01" },
      CONFIG,
    );
    expect(v18.status).toBe("COMPLETED");
    expect(v14.status).toBe("COMPLETED");
  });

  it("id ausente → throw", () => {
    expect(() =>
      api4comAdapter.normalize(
        { eventType: "channel-hangup", duration: 0 },
        CONFIG,
      ),
    ).toThrow();
  });
});

describe("extractCrmMetadata", () => {
  it("snake_case (convenção Api4com)", () => {
    const meta = extractCrmMetadata({
      metadata: {
        gateway: "crm-org-1",
        crm_user_id: "u-1",
        deal_id: "d-1",
        contact_id: "c-1",
      },
    });
    expect(meta).toEqual({
      gateway: "crm-org-1",
      crmUserId: "u-1",
      dealId: "d-1",
      contactId: "c-1",
    });
  });

  it("camelCase (defensivo)", () => {
    const meta = extractCrmMetadata({
      metadata: {
        gateway: "crm-org-1",
        crmUserId: "u-1",
        dealId: "d-1",
        contactId: "c-1",
      },
    });
    expect(meta).toEqual({
      gateway: "crm-org-1",
      crmUserId: "u-1",
      dealId: "d-1",
      contactId: "c-1",
    });
  });

  it("metadata ausente → objeto vazio", () => {
    expect(extractCrmMetadata({})).toEqual({});
    expect(extractCrmMetadata(null)).toEqual({});
  });

  it("strings em branco são descartadas", () => {
    const meta = extractCrmMetadata({
      metadata: { gateway: "  ", deal_id: "" },
    });
    expect(meta.gateway).toBeUndefined();
    expect(meta.dealId).toBeUndefined();
  });
});
