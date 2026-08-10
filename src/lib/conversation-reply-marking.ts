/**
 * Org setting: contar outbound de agente/automação/IA nos filtros de inbox
 * (Aguardando/Respondidas) e na marcação denormalizada `lastMessageDirection`
 * / `hasAgentReply`.
 *
 * Default OFF — só reply humano altera abas e (para bots) a marcação.
 */

import { getOrgSettingFor } from "@/lib/org-settings";
import { getOrgIdOrNull } from "@/lib/request-context";

export const COUNT_AGENT_REPLY_SETTING_KEY =
  "conversation.countAgentReplyAsAnswered";

export type BotOutboundReplyMark = {
  lastMessageDirection: "out";
  hasAgentReply: true;
};

export async function countAgentReplyAsAnswered(
  orgId?: string | null,
): Promise<boolean> {
  const id = orgId ?? getOrgIdOrNull();
  if (!id) return false;
  const raw = await getOrgSettingFor(id, COUNT_AGENT_REPLY_SETTING_KEY);
  return raw === "true";
}

/**
 * Campos a mesclar no `conversation.update` após outbound não-humano.
 * Vazio quando o setting está off (não marca direção / hasAgentReply).
 */
export async function botOutboundReplyMark(
  orgId?: string | null,
): Promise<BotOutboundReplyMark | Record<string, never>> {
  if (await countAgentReplyAsAnswered(orgId)) {
    return { lastMessageDirection: "out", hasAgentReply: true };
  }
  return {};
}
