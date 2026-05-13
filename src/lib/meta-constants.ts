/**
 * Configuração do App Meta do CRM (WhatsApp Business / Embedded Signup).
 *
 * `CRM_META_APP_ID` e `CRM_META_ES_CONFIG_ID` são públicos (aparecem no
 * bundle do client em qualquer integração com o JS SDK do Meta) e mantêm
 * defaults pra continuar funcionando out-of-the-box em dev. Eles podem
 * ser sobrescritos via env quando o cliente final tiver app próprio.
 *
 * `CRM_META_APP_SECRET` é SECRETO e NUNCA pode ter fallback hardcoded —
 * é o que valida assinatura dos webhooks. Antes este arquivo embarcava
 * o secret padrão no bundle, o que (a) vazava material criptográfico e
 * (b) deixava qualquer um forjar webhooks assinados. Agora exigimos
 * obrigatoriamente via env (ou via `Channel.config.appSecret` no banco,
 * lido pelo collector do webhook).
 */
export const CRM_META_APP_ID =
  process.env.NEXT_PUBLIC_META_APP_ID?.trim() || "931372239498163";

export const CRM_META_ES_CONFIG_ID =
  process.env.NEXT_PUBLIC_META_ES_CONFIG_ID?.trim() || "1510210360812755";

export const CRM_META_APP_SECRET = process.env.META_APP_SECRET?.trim() || "";
