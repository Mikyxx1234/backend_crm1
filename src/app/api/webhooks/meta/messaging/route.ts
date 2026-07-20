/**
 * Rota GLOBAL do webhook Meta para Messenger e Instagram Direct.
 *
 * URL publica (unica por deploy): /api/webhooks/meta/messaging
 *
 * Configuracao no painel do App Meta (developers.facebook.com):
 *   - Messenger > Configuracao > Callback URL: https://<dominio>/api/webhooks/meta/messaging
 *   - Instagram > Configuracao > Callback URL: mesma URL
 *   - Verify Token: valor de META_WEBHOOK_VERIFY_TOKEN
 *   - Assinar campos: messages, messaging_postbacks
 *
 * Nao ha URL por org: a Meta permite apenas uma callback por produto. A
 * resolucao da org e feita dentro do handler pelo `entry[].id` (pageId
 * para Messenger; instagramAccountId para Instagram), casando com
 * Channel.config.pageId / Channel.config.instagramAccountId.
 */
import {
  handleMessagingWebhookGet,
  handleMessagingWebhookPost,
} from "@/lib/meta-webhook/messaging-handler";

export async function GET(request: Request) {
  return handleMessagingWebhookGet(request);
}

export async function POST(request: Request) {
  return handleMessagingWebhookPost(request);
}
