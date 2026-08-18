import { describe, expect, it } from "vitest";

import {
  asMetaId,
  extractMessagingEvents,
} from "@/lib/meta-webhook/messaging-payload";

describe("extractMessagingEvents", () => {
  it("mantem entry.messaging do Messenger/IG Page", () => {
    const events = extractMessagingEvents({
      id: "17841449011856620",
      messaging: [
        {
          sender: { id: "igsid-user" },
          recipient: { id: "17841449011856620" },
          message: { mid: "m1", text: "oi" },
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.sender?.id).toBe("igsid-user");
    expect(events[0]?.message?.text).toBe("oi");
  });

  it("aceita Instagram Login em changes[].value com from + message string", () => {
    const events = extractMessagingEvents({
      id: "17841449011856620",
      changes: [
        {
          field: "messages",
          value: {
            from: { id: "igsid-user", username: "pessoa" },
            id: "m2",
            message: "alo do insta",
          },
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.sender?.id).toBe("igsid-user");
    expect(events[0]?.message?.text).toBe("alo do insta");
    expect(events[0]?.message?.mid).toBe("m2");
  });

  it("aceita changes[].value.messages[]", () => {
    const events = extractMessagingEvents({
      id: 17841449011856620,
      changes: [
        {
          field: "messages",
          value: {
            messages: [
              {
                from: { id: "u1" },
                message: { mid: "m3", text: "nested" },
              },
            ],
          },
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.sender?.id).toBe("u1");
    expect(events[0]?.message?.text).toBe("nested");
  });
});

describe("asMetaId", () => {
  it("converte number e string", () => {
    expect(asMetaId(" 178414 ")).toBe("178414");
    expect(asMetaId(178414)).toBe("178414");
    expect(asMetaId(undefined)).toBe("");
  });
});
