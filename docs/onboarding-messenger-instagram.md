# Onboarding — Canais Facebook Messenger e Instagram Direct

Setup dos canais Messenger (via Facebook Login for Business) e Instagram
Direct (via Instagram Business Login, sem Pagina do Facebook — padrao
Kommo/Meta 2024+).

Sao dois fluxos independentes:

- **Messenger**: Facebook Login for Business com `config_id` dedicada.
- **Instagram**: OAuth redirect direto em `instagram.com/oauth/authorize`,
  novo provider Prisma `META_INSTAGRAM_LOGIN`.

Ambos usam o mesmo webhook global `/api/webhooks/meta/messaging`.

## 1. Configuracao Meta — Messenger (Facebook Login for Business)

1. Acesse `https://developers.facebook.com/apps/` e abra o App do CRM.
2. Em **Products**, adicione **Facebook Login for Business** e **Messenger**.
3. Em **Facebook Login for Business > Configurations > Create configuration**:
   - Login variation: **Business login**
   - Permissoes: `pages_show_list`, `pages_messaging`,
     `pages_manage_metadata`, `business_management`.
   - Salve e copie o `Configuration ID` para
     `NEXT_PUBLIC_META_MESSENGER_CONFIG_ID` no `.env`.
4. Em **Messenger > Settings > Callback URL**:

   ```
   https://<backend>/api/webhooks/meta/messaging
   ```

   Verify Token = `META_WEBHOOK_VERIFY_TOKEN`.
   Campos: `messages`, `messaging_postbacks`, `message_deliveries`,
   `message_reads`.
5. Em App Review, solicite as permissoes acima (nao precisa mais de
   `instagram_basic`/`instagram_manage_messages` — o IG vai por outro app/produto).

## 2. Configuracao Meta — Instagram Business Login (direto)

1. No mesmo App (ou novo), em **Products > Instagram > API setup with
   Instagram Login**.
2. Adicione a conta Instagram Business como tester.
3. Em **Business Login Settings**:
   - Callback URL: `https://<backend>/api/channels/instagram/oauth/callback`
   - Deauthorize / Data deletion: opcional.
   - Copie **Instagram App ID** e **Instagram App Secret** para o `.env`
     como `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` e
     `NEXT_PUBLIC_INSTAGRAM_APP_ID`.
4. Em **Webhooks (Instagram)**:
   - Callback URL: `https://<backend>/api/webhooks/meta/messaging`
   - Verify Token: `META_WEBHOOK_VERIFY_TOKEN` (mesmo do Messenger).
   - Campo: `messages`.
5. Permissoes solicitadas via OAuth (embutidas no `buildAuthorizeUrl`):
   `instagram_business_basic`, `instagram_business_manage_messages`.

## 3. Fluxo do usuario no CRM

- **Messenger**: `/settings/channels > Novo canal > Facebook > Entrar com
  Facebook`. O SDK abre popup do FB.login (usando `config_id`), retorna
  `code`, backend troca por User Token, lista Paginas, usuario escolhe,
  backend assina webhooks e cria `Channel` com `provider=META_CLOUD_API`.
- **Instagram**: `/settings/channels > Novo canal > Instagram > Entrar
  com Instagram`. O browser abre popup pra
  `/api/channels/instagram/oauth/start`, que redireciona (302) pra
  `instagram.com/oauth/authorize`. Apos autorizacao, Meta redireciona pro
  `/callback`, que troca code -> short token -> long-lived token,
  faz `subscribed_apps?subscribed_fields=messages` e cria `Channel` com
  `provider=META_INSTAGRAM_LOGIN` e `config = { platform: "instagram",
  instagramUserId, username, accessToken (encriptado) }`.

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
