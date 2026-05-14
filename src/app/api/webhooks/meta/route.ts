/**
 * Rota legacy do webhook Meta WhatsApp (sem orgSlug).
 *
 * Mantida por backward compat enquanto a Eduit migra o callback no
 * painel Meta dela pra /api/webhooks/meta/<slug-da-org>. Apos validacao
 * da migracao (logs sem trafego nesta rota por 24-48h), este arquivo
 * sera REMOVIDO no Deploy 2.
 *
 * Toda a logica vive em src/lib/meta-webhook/handler.ts. Esta rota chama
 * o handler SEM scope, o que dispara warnings DEPRECATED nos logs.
 */
import {
  handleMetaWebhookGet,
  handleMetaWebhookPost,
} from "@/lib/meta-webhook/handler";

export const GET = (request: Request) => handleMetaWebhookGet(request);
export const POST = (request: Request) => handleMetaWebhookPost(request);
