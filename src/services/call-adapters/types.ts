import type { CallProviderConfig } from "@prisma/client";

/**
 * Evento de chamada normalizado, agnóstico de provedor.
 * Produzido pelo adapter a partir do payload bruto do webhook.
 */
/**
 * Metadados CRM extraídos do payload do webhook — usados para correlacionar a
 * chamada com a entidade que originou o `/dialer` (deal, contato, agente).
 *
 * Provedores que devolvem o `metadata` enviado no `/dialer` (ex.: Api4com)
 * preenchem estes campos; provedores que não suportam ficam com tudo
 * `undefined`.
 */
export type CallCrmMetadata = {
  dealId?: string;
  contactId?: string;
  /** ID do usuário CRM que originou a chamada (vem como `crm_user_id`). */
  crmUserId?: string;
  /** Gateway lógico (= chave que amarra webhookConstraint ↔ /dialer). */
  gateway?: string;
};

/**
 * Tipos de evento granular do webhook — distintos do `status` (que é o
 * estado da `Call`). Usados na chave de idempotência por evento e para
 * decidir quando emitir `ActivityEvent` na timeline.
 */
export type CallEventKind =
  | "RINGING"
  | "ANSWERED"
  | "HANGUP"
  | "OTHER";

export type NormalizedCallEvent = {
  /** ID único da chamada no provedor (usado para idempotência). */
  providerCallId: string;
  direction: "INBOUND" | "OUTBOUND";
  from: string;
  to: string;
  status: "RINGING" | "ANSWERED" | "COMPLETED" | "MISSED" | "BUSY" | "FAILED";
  /** ISO 8601 — timestamp do evento. */
  timestamp: string;
  /** URL da gravação no provedor (antes de re-hospedar). */
  recordingUrl?: string;
  /**
   * Tipo do evento (granularidade do webhook). Default: derivado do `status`.
   * Adapters sofisticados (Api4com) devolvem `ANSWERED` em `channel-answer` e
   * `HANGUP` em `channel-hangup`, distinguindo os dois envios para a mesma
   * `providerCallId`.
   */
  eventKind?: CallEventKind;
  /** Metadados CRM (opcional). Preenchido por provedores que ecoam metadata. */
  crmMetadata?: CallCrmMetadata;
  /** Em segundos — vem do hangup quando disponível, sobrescreve cálculo. */
  durationSeconds?: number;
  /** Causa do hangup (para auditoria/UI). */
  hangupCause?: string;
};

/**
 * Interface que todo adapter de provedor SIP deve implementar.
 * O adapter é stateless; toda configuração vem do CallProviderConfig.
 */
export interface CallAdapter {
  /**
   * Transforma o payload bruto (do webhook) em NormalizedCallEvent.
   * Deve ser puro e não fazer IO.
   *
   * @throws Error se não conseguir extrair campos obrigatórios.
   */
  normalize(rawPayload: unknown, config: CallProviderConfig): NormalizedCallEvent;
}
