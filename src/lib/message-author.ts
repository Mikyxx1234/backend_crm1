/**
 * Helper para classificar a autoria de uma mensagem de forma explícita no código.
 *
 * O DB tem um trigger `trg_message_author_type_default` que cobre casos
 * legados (serviços que ainda não conhecem o campo `authorType`), mas novo
 * código deve preferir setar `authorType` explicitamente via este helper
 * para deixar a intenção clara e permitir remover o trigger no futuro.
 */
export type MessageAuthorType = "human" | "bot" | "system";

/**
 * Inferência heurística a partir do que foi gravado historicamente no CRM:
 * - `senderName === "Automação"` → bot (convenção do automation-executor)
 * - `direction === "system"` → system (eventos de ciclo de vida do Meta)
 * - caso contrário → human (agentes do CRM + clientes que escrevem do outro lado)
 */
export function inferMessageAuthorType(input: {
  senderName?: string | null;
  direction?: string | null;
}): MessageAuthorType {
  if (input.senderName === "Automação") return "bot";
  if (input.direction === "system") return "system";
  return "human";
}
