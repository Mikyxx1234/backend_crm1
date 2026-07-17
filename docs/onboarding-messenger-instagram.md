# Onboarding — Canais Facebook Messenger e Instagram Direct

Setup dos canais IG/Messenger via App Meta do CRM (mesma infra do WhatsApp Cloud).

## 1. Configuracao no painel do App Meta (uma vez por deploy)

1. Acesse `https://developers.facebook.com/apps/` e abra o App do CRM
   (o mesmo cujo App Id esta em `NEXT_PUBLIC_META_APP_ID`).
2. Em **Add products**, adicione:
   - **Messenger** (Facebook Login for Business ja precisa estar habilitado).
   - **Instagram** (produto "Instagram", nao "Instagram Basic Display").
3. Em **Messenger > Settings > Callback URL** e **Instagram > Settings >
   Callback URL**, configure a MESMA URL:

   ```
   https://<dominio-do-backend>/api/webhooks/meta/messaging
   ```

   com o **Verify Token** = valor de `META_WEBHOOK_VERIFY_TOKEN`.
4. Assine os campos de webhook em cada produto:
   - Messenger: `messages`, `messaging_postbacks`,
     `message_deliveries`, `message_reads`.
   - Instagram: `messages`, `messaging_postbacks`.
5. Em **App Review**, solicite as permissoes:
   `pages_show_list`, `pages_messaging`, `pages_manage_metadata`,
   `business_management`, `instagram_basic`, `instagram_manage_messages`.
   Durante dev/teste o app funciona com contas de tester.

## 2. Como o cliente conecta uma Pagina (fluxo do CRM)

1. Em `/settings/channels`, clicar em **Novo canal**.
2. Escolher **Facebook** (Messenger) ou **Instagram**.
3. No passo 3, clicar **Entrar com Facebook** — o SDK abre popup OAuth.
4. Escolher a Pagina desejada na lista devolvida pelo backend.
5. Clicar **Conectar canal**. O backend:
   - Troca o `code` por Page Access Token (long-lived).
   - Faz `POST /{pageId}/subscribed_apps` para assinar webhooks da Pagina.
   - Se plataforma = instagram, resolve
     `instagram_business_account.id` a partir da Pagina.
   - Persiste `Channel` com `type=FACEBOOK|INSTAGRAM`,
     `provider=META_CLOUD_API` e `config = { platform, pageId, pageName,
     accessToken (encriptado), instagramAccountId? }`.

## 3. Resolucao do canal no webhook

A callback URL do App Meta e **unica por produto** — nao ha URL scoped
por organizacao (como no WhatsApp). O handler
`src/lib/meta-webhook/messaging-handler.ts` resolve a org pelo id do
`entry[]`:

- `object: "page"`     → `entry[].id` = **pageId** →
  match em `Channel.config.pageId` (`type=FACEBOOK`).
- `object: "instagram"` → `entry[].id` = **instagramAccountId** →
  match em `Channel.config.instagramAccountId` (`type=INSTAGRAM`).

## 4. Envio de mensagens

- `Conversation.channel` = `"messenger"` ou `"instagram"` roteia para
  `src/lib/send-meta-messaging.ts` em
  `POST /api/conversations/{id}/messages`.
- Destinatario e resolvido em `Contact.messengerPsid` ou
  `Contact.instagramIgsid` (populado pelo webhook no primeiro DM
  recebido).
- Restricao Meta: janela de 24h desde a ultima mensagem do cliente.
  Sem tag (`HUMAN_AGENT` etc.) a Meta recusa envios fora da janela — o
  erro e persistido em `Message.sendError`.

## 5. Variaveis de ambiente

Nenhuma variavel nova. Reutiliza:

- `META_APP_SECRET`             — assinatura dos webhooks (mesma do WA).
- `META_WEBHOOK_VERIFY_TOKEN`   — handshake GET (mesmo do WA).
- `NEXT_PUBLIC_META_APP_ID`     — App Id lido pelo SDK do Facebook Login.
- `KEYRING_SECRET`              — encriptacao do Page Access Token em
  `Channel.config.accessToken` (via `SENSITIVE_FIELDS[META_CLOUD_API]`).
