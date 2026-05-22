# Changelog — Backend CRM

Formato: [Conventional Commits](https://www.conventionalcommits.org/) agrupado por release.
Datas em ISO 8601. Mais recente no topo.

## [Unreleased] — branch `marcelinho`

> Aguardando merge via PR para `main`.

### feat
- **ad-tracking**: capturar UTMs do ad via `url_tags` da Marketing API — `meta-ad-resolver.ts` agora pede o campo `url_tags` ao Graph, faz parse com `parseUrlTags()` e persiste em 5 colunas novas no `Contact` (`adUtmSource`, `adUtmMedium`, `adUtmCampaign`, `adUtmContent`, `adUtmTerm`). Expostas em `getAutomationLogs` e `GET /contacts/[id]`. (`8a2c1b4`)
- **ad-tracking**: resolver `post → ad` via Meta Marketing API quando o webhook envia `source_type='post'` — chama Graph API com `ads_read`, cacheia em 9 colunas do `Contact` (`adResolvedId`, `adResolvedName`, `adResolvedAdsetId/Name`, `adResolvedCampaignId/Name`, `adResolvedAt`, `adResolveStatus`, `adResolveError`). Fire-and-forget via `resolveAdAndPersistAsync()`. (`ad2c52c`)

### db
- migration `20260521150000_contact_ad_resolution` — adiciona 9 colunas de cache de resolução de anúncio + 3 índices (`adResolvedId`, `adResolvedCampaignId`, `adResolveStatus`).
- migration `20260521170000_contact_ad_utms` — adiciona 5 colunas UTM + 2 índices (`adUtmSource`, `adUtmCampaign`).

> ⚠️ Aplicadas manualmente em produção via `psql` no Easypanel (com registro em `_prisma_migrations`) porque `SKIP_PRISMA_MIGRATE=1` está ativo no container.

---

## [1.4.0] — 2026-05-21

Release que entrou em produção via Easypanel.

### feat
- **automations**: log com payload bruto do webhook Meta — novo model `MetaWebhookEvent` (raw payload + headers HTTP filtrados via `pickWebhookHeaders()`), FK `metaWebhookEventId` no `AutomationLog`, helpers `createMetaWebhookEvent` / `markWebhookEventProcessed` no `meta-webhook/handler.ts`. Exposto em `getAutomationLogs` com `include: { metaWebhookEvent: { select: {...} } }`. (`0da855a`)

### db
- migration `20260521120000_meta_webhook_events` — cria tabela `meta_webhook_events` (raw JSONB, headers, status, processedAt, channelId, organizationId, fingerprint) + FK em `automation_logs`.

---

## [1.3.0] — 2026-05-20

### fix
- **authz**: sincroniza `UserRoleAssignment` ao criar/editar usuário — corrige caso em que role mudava na UI mas não refletia nas checagens de RBAC. (`ce23339`)
- **audio**: instala `ffmpeg` do sistema no container para conversão OGG/Opus em PTT — bypass do binário static linkado que não rodava em algumas arquiteturas. (`4b35a6b`)
- **storage**: conserta ownership do volume `/app/storage` via `gosu` no entrypoint — evita EACCES quando o volume monta como root. (`229c376`)

### feat
- **storage**: upstream fallback proxy — quando o arquivo não existe local, tenta buscar no Meta CDN antes de retornar 404 (útil em migração entre instâncias). (`2291bcd`)

---

## [1.2.0] — 2026-05-19

### feat
- **kanban-filters**: filtros avançados de Kanban + customização de flows WhatsApp. (`5d5b123`)

### fix
- **kanban-filters**: parser defensivo + datas timezone-safe + erros detalhados na API de filtros. (`bfb7ab6`)
- **kanban-filters**: busca por telefone normalizada (remove máscara antes do `LIKE`) + script `reset-password.ts`. (`e1b4f03`)

---

## [1.1.0] — 2026-05-18

### feat
- **webhook**: mostra valores preenchidos em resposta de WhatsApp Flow no chat — extrai `response_json` e renderiza como bubble do contato. (`c2d945d`)
- **webhook**: logs estruturados em respostas de WhatsApp Flow (debug). (`c6b1283`)

### fix
- **agents**: trata P2025 no `PUT /agents/[id]/status` — `AgentStatus` cross-org não estourava 500 mais. (`f408926`)

### chore
- **webhook**: build marker pra forçar invalidação do cache do Easypanel. (`43be8f1`, `a09913d`)

### docs
- **agent**: registra padrão de registros órfãos cross-org sob Prisma RLS (`AGENT.md`). (`d7aca3c`)
- **agent**: decisão de rodar sem Redis em ambiente de teste compartilhado. (`ffb7dc2`)
- **agent**: decisões de `SKIP_PRISMA_MIGRATE` e `NEXTAUTH_URL` inlining. (`50d9066`)

---

## [1.0.0] — 2026-05-17

### feat
- **fork**: re-fork from monolith main multi-tenant — base do backend CRM separado em repo próprio. (`6639891`)

### fix
- **auth**: não inlinear `NEXTAUTH_URL` em build time — vinha sendo injetado no bundle e quebrava em multi-environment. (`2399c1e`)
- **build**: remove `serwist` e adiciona deps faltantes pro build prod. (`e5271ac`)
- **prisma**: adiciona schema baseline pra destravar databases novos. (`5ed72ce`)
- **docker**: instala Prisma CLI completo no runner (deps `effect`/`c12`). (`084d653`)
- **docker**: entrypoint roda `prisma migrate deploy` (v6) antes do server, fix `HOME`. (`7b45e1a`)
- **docker**: garante `public/` pra cópia em standalone. (`a81656a`)
- **sse-bus**: pula background workers durante o build de produção do Next. (`2e03b25`)

### docs
- **env**: clarifica que `DATABASE_URL` deve apontar pro database do CRM. (`49ce8dd`)
