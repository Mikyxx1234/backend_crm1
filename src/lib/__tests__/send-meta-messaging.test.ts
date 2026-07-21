/**
 * Testes puros do helper `platformFromConversationChannel` — decide
 * se uma conversa deve entrar no fluxo Messenger, Instagram ou
 * WhatsApp/outros a partir do slug `Conversation.channel`.
 */
import { describe, expect, it } from "vitest";

import { platformFromConversationChannel } from "@/lib/send-meta-messaging";

describe("platformFromConversationChannel", () => {
  it("reconhece 'messenger' → messenger", () => {
    expect(platformFromConversationChannel("messenger")).toBe("messenger");
  });

  it("reconhece 'facebook' → messenger (alias legado)", () => {
    expect(platformFromConversationChannel("facebook")).toBe("messenger");
  });

  it("reconhece 'instagram' → instagram", () => {
    expect(platformFromConversationChannel("instagram")).toBe("instagram");
  });

  it("case-insensitive", () => {
    expect(platformFromConversationChannel("Instagram")).toBe("instagram");
    expect(platformFromConversationChannel("MESSENGER")).toBe("messenger");
  });

  it("whatsapp/email/webchat → null (nao e' canal de messaging)", () => {
    expect(platformFromConversationChannel("whatsapp")).toBeNull();
    expect(platformFromConversationChannel("email")).toBeNull();
    expect(platformFromConversationChannel("webchat")).toBeNull();
  });

  it("null/undefined/empty → null", () => {
    expect(platformFromConversationChannel(null)).toBeNull();
    expect(platformFromConversationChannel(undefined)).toBeNull();
    expect(platformFromConversationChannel("")).toBeNull();
  });
});
