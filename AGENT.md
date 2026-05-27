# Decisões Estruturais — CRM EduIT (Backend)

Registro de decisões técnicas que afetam estrutura do projeto. Cada entrada
documenta **por que** algo foi feito, não **o que**.

---

### 2026-05-27 — Ops `has_tag` / `not_has_tag` nas condições de automação

**Decisão.** Estender `automation-condition.ts` com dois novos operadores
(`has_tag` e `not_has_tag`) e enriquecer o `RuntimeContext` em
`automation-executor.ts` para expor `contactTagNames`/`contactTagIds` e
seus pares de deal. No `evalRoot` da condition, esses arrays viram
`contact.tags` (nomes), `contact.tagIds` (IDs), `deal.tags`,
`deal.tagIds`. O comparador case-insensitive em `evalCondition` aceita
match contra qualquer um dos dois arrays — o usuário escolhe um NOME
no picker da UI, mas configs antigos que salvarem ID continuam
funcionando.

**Contexto.** O operador pediu "se tem TAG X adicionada ou não" como
opção explícita na condição. A infra já tinha `add_tag`/`remove_tag`
como passos de ação, mas faltava a contrapartida de leitura no
`condition`. Usar o `includes` genérico contra `contact.tags` daria
pra resolver tecnicamente, mas seria descobrível só pra quem soubesse
o path do evalRoot — operador prefere ver "Tem a tag" como op de
primeira classe.

**Alternativas descartadas.**

- **Adicionar só o campo `contact.tags` e reusar `includes`/`empty`.**
  Funciona em runtime, mas a UI ficaria confusa (ops irrelevantes
  visíveis pro campo de tags). Preferimos ops explícitos com label
  "Tem a tag" / "Não tem a tag", filtrados no select da UI quando o
  campo é de tag — UX claro.
- **Carregar tags lazy no `evalCondition`.** Mais "preguiçoso" mas
  exigiria uma query extra por rule de condition. Carregando junto no
  `resolveRuntimeContext` (uma única `include`) batemos no banco uma
  vez por job — muito mais barato.
- **Salvar IDs no value picker em vez de nomes.** Mais resiliente a
  renomes mas exige que o operador veja UUIDs (ruim). O picker salva
  nome; o evaluator faz match contra nome E id (case-insensitive),
  então compat com configs antigas que vinham com ID é mantida.

**Impacto.** Backward-compatible — automações antigas sem ops de tag
não veem diferença (tags são carregadas mas só consultadas se a rule
pedir). Custo de banco: +1 include em `resolveRuntimeContext`
(`TagOnContact` + `TagOnDeal`) por job — tabela tem índice em
`(contactId)`/`(dealId)`, custo negligível.

---

### 2026-05-27 — Filtros de pipeline/estágio nos gatilhos de automação

**Decisão.** Estender o `evaluateTrigger` em `src/services/automations.ts`
para suportar filtros opcionais por `pipelineId` e `stageId` nos gatilhos
`contact_created`, `deal_created`, `deal_won` e `deal_lost`. Também
padronizar a leitura de `stageId`/`pipelineId` em `message_received` e
`message_sent` (antes só lia `dealStageId`/`dealPipelineId` enriquecidos
internamente — agora aceita os dois nomes pra permitir que a UI escreva
os campos canônicos).

Como o evento `contact_created` é disparado em paralelo ao auto-deal
(via `ensureOpenDealForContact` em `src/services/auto-deals.ts`), o
filtro por estágio só vale se o deal já tiver sido criado quando o
trigger chegar no worker. Pra maximizar a janela útil, `enrichContext`
em `src/services/automation-triggers.ts` agora faz um lookup
best-effort do deal aberto mais recente do contato.

**Contexto.** O operador relatou no chat que (a) não conseguia editar a
automação depois de salvar o fluxo e (b) faltavam gatilhos do tipo
"mensagem recebida em X estágio" e "lead/contato criado em X estágio".

- **(a)** Já existia rota de edição (`PUT /api/automations/[id]`) — o
  problema era UX no frontend: o nó do gatilho no canvas era inerte. A
  correção é só no frontend (ver entrada gêmea no AGENT.md do
  frontend_crm1).
- **(b)** O backend já enriquecia `message_received`/`message_sent` com
  estágio do deal aberto, mas (i) lia só `dealStageId`/`dealPipelineId`
  (forçando a UI a escrever esses nomes específicos), e
  (ii) `contact_created` retornava sempre `true` sem nenhum filtro.

**Alternativas descartadas.**

- **Adicionar um novo gatilho separado, `contact_created_in_stage`.**
  Multiplicaria o número de tipos sem ganho — o mesmo evento com config
  opcional já cobre os dois casos (filtra ou não filtra). Mais código
  pra manter e mais friction pro usuário escolher entre dois gatilhos
  quase idênticos.
- **Reordenar o disparo: criar o deal ANTES de emitir
  `contact_created`.** Tem efeito colateral em quem já usa o gatilho
  hoje (o payload mudaria de momento de emissão). Como o trigger é
  fire-and-forget e vai pro worker (delay natural de BullMQ), a janela
  de race quase sempre fica do nosso lado — o enrich best-effort
  resolve >95% dos casos sem mudar contratos.
- **Forçar `stageId` obrigatório quando configurado no
  `contact_created`.** Já é o comportamento (`if (stageId && !dataStageId)
  return false`), só explicitado no comentário pra evitar bug futuro.

**Impacto.** Automações existentes que usam `contact_created` ou
`deal_*` sem `stageId`/`pipelineId` configurado continuam disparando
exatamente como antes (filtros opcionais — só restringem se
preenchidos). Mudança backward-compatible.

---

### 2026-05-27 — `POST /api/leads` atômico + Bearer destravado em `/custom-fields`

**Decisão.**

1. Migrar `GET/PUT /api/contacts/[id]/custom-fields` e
   `GET/PUT /api/deals/[id]/custom-fields` de `withOrgContext` para o par
   `authenticateApiRequest` + `runWithApiUserContext`. Resultado prático:
   ambos passam a aceitar **Bearer**, igual ao restante de `/api/contacts/*`
   e `/api/deals/*`.
2. Criar `POST /api/leads` — endpoint **atômico** que faz lead-or-create em
   uma única chamada: contato (idempotente por phone → email), bloco
   opcional de deal no `stageId` escolhido, custom fields de contato e de
   deal (resolvidos por `fieldId` **ou** `name`), e disparo do trigger
   `deal_created`.

**Contexto.** O usuário rodando integração via n8n bateu em três muros:

- O curl `GET /api/contacts?phone=...` parecia funcionar mas retornava 456
  contatos (todos da org) porque o deployment antigo no Easypanel
  (`banco-backend-crm.6tqx2r.easypanel.host`) rodava código **antes** do
  PR que adicionou `?phone=` exato (entrada AGENT.md de 26/mai/2026,
  linha 77). O deployment correto (`backend-backend.v74knz.easypanel.host`)
  já tinha o filtro e devolvia `total=1`. Resolveu trocando a URL no n8n.
- `PUT /api/contacts/[id]/custom-fields` e `PUT /api/deals/[id]/custom-fields`
  devolviam 401 mesmo com Bearer válido porque ambos usavam
  `withOrgContext`, que só lê cookie do NextAuth (não tem fallback para
  Bearer). Validado por reprodução com curl real:
  `GET /api/contacts/<id>/custom-fields` com Bearer → 401 "Não autorizado.".
- Mesmo destravados, o fluxo "criar lead com contato + custom fields +
  stage" exigia 4 round-trips (`POST /api/contacts` → `POST /api/deals` →
  `PUT contact custom-fields` → `PUT deal custom-fields`), com janela de
  inconsistência se alguma das chamadas falhasse no meio. n8n não tem
  transação distribuída — o estado podia ficar parcial (contato sem deal,
  deal sem custom fields).

**Alternativas descartadas.**

- **Trocar `withOrgContext` por `withApiAuthContext` em todos os ~70 routes
  que ainda usam o primeiro.** Tentador, mas a maioria desses routes é
  admin/settings/inbox interno que **não tem caso de uso Bearer hoje** e
  carrega contratos de sessão (cookies, CSRF) que mudariam de comportamento.
  Risco/benefício ruim — refatoração ampla por um requisito que cobre 2 rotas.
- **Criar `/api/v2/leads` em outro path e deixar a v1 quebrada.** Versionar
  cedo demais cria carga cognitiva e dois caminhos pra manter. O endpoint
  novo é aditivo (nenhum endpoint existente muda contrato), não precisa
  bump de versão.
- **Webhook do n8n entrando direto em `/api/webhooks/n8n` (sem Bearer).**
  Significaria HMAC compartilhado e rota pública — mais superfície de
  ataque e divergência do padrão Bearer já documentado. Bearer com token
  por org é o caminho canônico.
- **Custom field upsert via array `[ { name, value } ]` em vez de `[ { fieldId, value } ]`.**
  Mantemos suporte aos dois (resolve por `name` quando `fieldId` está
  ausente). Resolver por name é "human-friendly" pro n8n; resolver por id
  é determinístico e não muda quando a label do campo é editada. O endpoint
  novo aceita os dois e devolve `missingCustomFields` quando o `name` não
  bate — falha não-fatal, não derruba a request inteira.

**Impacto.**

- Zero migração de schema. Apenas três arquivos novos/alterados:
  - `src/app/api/contacts/[id]/custom-fields/route.ts` (Bearer destravado).
  - `src/app/api/deals/[id]/custom-fields/route.ts` (Bearer destravado;
    mantém `requirePermissionForUser` + `canEditFieldForUser` por campo;
    continua gerando evento `CUSTOM_FIELD_UPDATED` na timeline).
  - `src/app/api/leads/route.ts` (novo, ~360 linhas; reusa
    `createContact`, `updateContact`, `createDeal`,
    `upsertContactCustomFieldValues`, `upsertDealCustomFieldValues`).
- A idempotência do `POST /api/leads` é **best-effort**, não transacional:
  o lookup de contato roda fora da transação (Prisma extension não
  envolve `findFirst` em transação implícita). Em concorrência alta, duas
  chamadas com o mesmo phone podem ambas criar contato — colisão raríssima
  no caso real (n8n + lead único por trigger) e fica P2002 quando email
  é único na org. Follow-up: usar `prisma.contact.upsert` + chave única
  composta `(organizationId, phone_normalized)` exigiria nova column +
  migration; não foi feito agora.
- O endpoint **sempre cria deal novo** quando o bloco `deal` está presente
  (mesmo se o contato foi reusado). Deduplicar deal automaticamente
  exigiria mais regras de negócio (qual stage? mesma pipeline? deal aberto
  ou qualquer?) e não cabe nesse PR. Caller faz `GET /api/deals?contactPhone=...`
  antes se precisar.
- `API_REFERENCE.md` atualizado: prefixo `crm_` → `eduit_`, body real do
  `PUT custom-fields` (array de `{ fieldId, value }`, não objeto literal),
  seção nova "`POST /api/leads`" com exemplo n8n.

---

### 2026-05-26 — `POST/PUT /api/users` diferencia P2002 cross-org

**Decisão.** Quando `prisma.user.create()` (POST `/api/users`) ou
`prisma.user.update({ data: { email } })` (PUT `/api/users/[id]`) caem em
`P2002` por colisão de `email`, o handler agora faz uma **segunda query
cross-org** (`prisma.user.findFirst({ where: { email } })`) para descobrir
**em qual organização** o duplicado vive. Se for em outra org, devolve uma
mensagem específica do tipo *"E-mail já cadastrado em outra organização
('Foo Inc.'). Peça ao usuário para sair da outra ou contate o suporte."* —
em vez do genérico *"E-mail já cadastrado."*. Aproveitou-se a passada para
normalizar `email.trim().toLowerCase()` e `name.trim()` no POST (o PUT já
fazia isso).

**Contexto.** `User.email` é `@unique` **global** no schema (linha 280 do
`schema.prisma`, comentário canônico: "um email pertence a uma única
org"). Combinado com `/api/signup` aberto, qualquer pessoa pode criar uma
org "fantasma" via signup público e ficar com o próprio email
sequestrado pra colisão. Caso real (2026-05-26): a admin DnaWork tentou
cadastrar `larissa@dnawork.ai` em `org_dnawork` e recebeu 409 — a Larissa
tinha feito signup público antes e ficou de ADMIN solo em uma org `dna-work`
com `onboardingCompletedAt=null`. Como `/settings/team` só lista users da
**própria** org (`userOrgFilter`), a duplicada era invisível e a "exclusão"
da admin nem ia a lugar nenhum (404 silencioso, percebido como sucesso).
Mensagem genérica fazia o admin ficar 30+ min sem saber por onde sair.

A correção do **caso pontual** foi um `DELETE FROM organizations WHERE id
= '<ghost>'` em transação (cascade do schema limpou User + agent_status +
agent_presence_logs + login_attempts + audit_log). Esse PR trata apenas a
prevenção da próxima ocorrência.

**Alternativas descartadas.**

- **Tornar `User.email` único por org (`@@unique([email, organizationId])`).**
  Resolveria de vez (o admin DnaWork conseguiria cadastrar `larissa@…` na
  org dele independentemente de outra org ter o mesmo email). MAS quebra
  premissa do NextAuth/login atual ("email identifica univocamente a
  conta"). Login precisaria pedir org (slug, subdomínio, dropdown) — é
  redesenho de auth, fora de escopo de bugfix. Migration também é
  arriscada em prod com 10k+ users.
- **Bloquear `/api/signup` para domínios de orgs já existentes.** Heurístico
  (e-mail Gmail/Hotmail anula o critério, e-mail corporativo é o caso útil
  mas exige extrair o domínio e comparar com algum campo da Organization
  que hoje não existe). Vale como follow-up, não como fix do P2002.
- **Soft-delete em `User.delete()` para nunca derrubar o registro.** O
  schema já tem `isErased` + `erasedAt` pra LGPD, mas o `DELETE
  /api/users/[id]` é hard delete proposital — soft-delete misturaria
  semântica e ainda não resolveria o caso (a Larissa não foi deletada de
  jeito nenhum, ela está em **outra** org).
- **Retornar o `organizationId` do duplicado no body do 409.** Vazaria
  informação cross-tenant (a admin DnaWork não tem motivo legítimo de
  saber o ID interno da org-fantasma). O nome da org vai porque o admin
  precisa de uma pista acionável; ID interno fica de fora.

**Impacto.**

- Zero alteração em schema, migration, NextAuth ou frontend (a UI já mostra
  `data.message` cru, então a string nova aparece automaticamente).
- O findFirst extra só roda no caminho de erro (P2002), que é raríssimo —
  não afeta latência do happy path.
- `prisma.user.findFirst` opera cross-org porque `User` **não está em
  `SCOPED_MODELS`** do `prisma.ts`. Nada a fazer manualmente; documentar
  aqui pra não regredir caso alguém pense em adicionar User ao scope no
  futuro.
- Follow-up sugerido (não incluso neste PR): considerar gating do
  `/api/signup` por allowlist de domínios ou por flag, pra reduzir a
  chance de "orgs fantasmas" criadas por convidado em vez de admin.

---

### 2026-05-26 — Filtros exatos `?email` / `?phone` em `/api/contacts` e `?contactEmail` / `?contactPhone` em `/api/deals`

**Decisão.** Estender os GETs de listagem com **filtros 1:1** (não-contains)
pelo email/telefone do contato, sem criar endpoint novo. Em `getContacts`
entraram `emailExact` e `phoneExact`; em `getDeals` entraram `contactEmail`,
`contactPhone` e `contactId`. Os `route.ts` correspondentes leem os query
params `email`, `phone` (contacts) e `contactEmail`, `contactPhone`,
`contactId` (deals) e repassam ao service. Comportamento de `?search=` e
qualquer chamada existente **fica intocado** — só ficou a superfície maior.

**Contexto.** O backend só tinha `?search=` (contains case-insensitive em
`name|email|phone|customFields`). Para integrações (n8n, Zapier, Make)
isso é ruim porque:

1. *Falso positivo:* procurar `maria@a.com` matcha também `mariaclara@a.com.br`.
2. *Sem booleano de existência:* o caller precisa baixar a página e fazer
   comparação manual no nó Code do n8n.
3. *Dois round-trips para deals:* não existia jeito de perguntar "esse
   contato tem deal aberto?" sem antes resolver o contactId via `/api/contacts`.

O caso disparador foi um workflow n8n "lead-or-create" — o operador queria
1 chamada por entidade para decidir entre `POST` (criar) ou `PUT`
(atualizar). Com `?search=` precisava de 1 GET + nó Code + IF — frágil
para emails parecidos.

**Por que estender o GET existente, e não criar `/api/contacts/lookup`.**

- **Estender GET (escolhido)** ✅ — segue o padrão do projeto (filtros via
  query são a forma canônica em todo o `app/api/**`). Diff trivial: ~20
  linhas em service + ~5 em route, zero quebra de compat. n8n usa direto
  com `?perPage=1` (`total=0` = não existe, `total>=1` = existe e dados já
  vêm em `items[0]`).
- **Endpoint dedicado `lookup` / `exists`** — semanticamente mais explícito,
  mas adiciona 2 endpoints a uma superfície já grande (318 rotas). Duplica
  a lógica do listing principal. Recusado por custo de manutenção.
- **`HEAD /api/contacts?email=...`** — idiomático HTTP (200 existe / 404
  não), mas no-code (n8n) lida muito melhor com JSON paginado do que com
  status code puro. Recusado por DX.
- **Workaround só no n8n** (status quo) — não resolve o falso positivo de
  `contains`. Mantém o overhead em todo workflow novo. Recusado.

**Match de telefone — tolerância a formatação.** O `Contact.phone` é
salvo só com `.trim()` no `route.ts` de POST (sem normalizar dígitos).
Existem registros com `+5511999998888`, `(11) 99999-8888`, `5511999998888`
no mesmo banco. Para `?phone` fazer sentido na prática usamos:

```ts
OR: [
  { phone: { equals: rawInput } },              // valor cru
  { phone: { endsWith: digitsOnly } },          // últimos N dígitos
]
```

Só ativa o `endsWith` quando o input tem >= 8 dígitos (evita matchar
"99" como sufixo). Não fizemos backfill de normalização do `phone` — seria
mudança destrutiva sem ganho proporcional; o `endsWith` cobre o caso real.

**Match de email.** `equals` com `mode: "insensitive"` (o Prisma traduz
para `ILIKE` no Postgres) — o input é forçado a lowercase antes da query
para evitar problemas com providers que case-folding diferente.

**Sem registro órfão.** A combinação `?email=` + `?lifecycleStage=LEAD`
funciona: ambos viram condições adicionais no `where` (AND). Mesmo
princípio para `?contactEmail=` + `?status=OPEN&pipelineId=...` em deals.

**Impacto operacional.**

- n8n: workflows ganham 1 chamada a menos por lead (era GET + Code; agora é
  só GET com `?email=`). Update no `API_REFERENCE.md` §6.1, §7.1 e §19.
- Sem migration. Sem mudança de schema.
- Bearer token continua sendo a forma recomendada de auth (mesmo padrão).

**Alternativas descartadas (resumo).**

- Endpoint dedicado `lookup` (acima).
- `HEAD` request (acima).
- Forçar normalização de `phone` no banco (custo > benefício para um caso
  resolvido por `endsWith`).
- Aceitar regex no `?phone=` (overkill; usuário pode usar `?search=` se
  precisar de fuzzy).

---

### 2026-05-26 — `Message.templateConfigId` (FK) corrige roteamento de Flow inbound

**Decisão.** Adicionar FK `Message.templateConfigId → WhatsAppTemplateConfig`
(nullable, `onDelete: SET NULL`) e gravar o vínculo em todos os call sites de
envio outbound de template. O resolver `resolveFlowDefinitionForInbound` passa
a usar esse FK como caminho primário (cascata exata → nome Meta → best-match
por field keys).

**Contexto.** O resolver original, quando a resposta inbound chegava com
`flow_token`, fazia `whatsAppTemplateConfig.findFirst({ where: { flowId: { not:
null } }, orderBy: { updatedAt: "desc" } })` — escolhia *qualquer* template
config com flowId da organização, ignorando completamente qual template foi
de fato enviado. Em orgs com 2+ templates Flow, a resposta era roteada para
o flow errado, os `fieldKey` não casavam, e todos os campos caíam em `skipped`
com motivo "Campo não configurado no flow do CRM". Sintoma reportado: *"o
form está configurado mas não preenche os dados nos campos do negócio"*.

**Por que FK e não outra abordagem.**

- **FK (`templateConfigId`)** ✅ — resolução O(1), integridade referencial,
  `onDelete: SET NULL` preserva histórico se o config for deletado.
- **String `templateMetaName`** — resiliente a deleção do config, mas
  renomear template Meta quebraria casamento futuro.
- **String `templateGraphId` (Meta ID)** — imune a renames internos, mas se
  a Meta refizesse o template (novo `metaTemplateId`), também quebraria.

A FK ainda permite consultas analíticas tipo "quantas respostas o flow X
gerou" via join — string IDs não dão isso barato.

**Mensagens antigas.** A coluna é nullable. Mensagens pré-migration mantêm
`templateConfigId = NULL` e seguem usando o fallback histórico (nome Meta +
best-match por keys) — não há backfill porque o gap só dói quando a org
tem múltiplos templates Flow, e a resposta antiga já foi processada (ou
não) há tempos.

**Call sites de envio atualizados:**

- `app/api/conversations/[id]/template/route.ts` — envio manual da inbox.
- `services/automation-executor.ts` — ação `send_whatsapp_template` de
  automações (Funil de Automações).
- `services/ai/tools.ts` — tool `send_whatsapp_template` do Agente IA.
- `services/scheduled-messages-worker.ts` — fallback template ao expirar
  janela 24h.

**Call sites NÃO atualizados (não disparam Flow):**

- `app/api/conversations/[id]/call-permission/route.ts` — pedido de
  permissão de ligação WhatsApp. Template específico sem botão Flow.
- `services/missed-call-schedule-offer.ts` — oferta de reagendamento após
  ligação perdida. Template fixo sem Flow.
- `workers/campaign-worker.ts` — campanhas em massa. Hoje campanhas não
  suportam Flow; quando passarem a suportar, atualizar aqui.

**Alternativas descartadas.**

- **Sem migration, só corrigir resolver pelo `flowMetaName`.** Funciona se
  a Meta sempre enviasse `nfm_reply.name`, mas ela não envia consistentemente
  — varia por categoria/template. A FK é o único caminho 100% determinístico.
- **Backfill retroativo das mensagens antigas.** Custo > valor: respostas
  antigas já foram processadas. Backfill via heurística seria adivinhar.

**Como testar pós-deploy.**

1. `prisma migrate deploy` aplica `20260526090000_add_message_template_config_id`
   no startup do container `APP_MODE=api`.
2. Enviar template Flow novo pela inbox → conferir no banco
   `SELECT template_config_id FROM messages WHERE conversation_id = '...' ORDER BY created_at DESC LIMIT 1;`
3. Cliente responde o Flow no WhatsApp → conferir log `[whatsapp-flow] apply
   concluído` com `flowDefinitionId` igual ao esperado e `applied.length > 0`.

---

### 2026-05-22 — APP_MODE separa API/workers no EasyPanel (1 imagem, 3 serviços)

**Decisão.** O Dockerfile produz uma única imagem que pode executar em três
modos via env `APP_MODE`:

- `APP_MODE=api` (default) — Next.js standalone server. Único modo que aplica
  `prisma migrate deploy` no entrypoint (workers não aplicam migrations para
  evitar race condition entre serviços do mesmo deploy).
- `APP_MODE=worker-whatsapp` — `node dist/workers/campaign-worker.js`. Consome
  as filas `campaign-dispatch` + `campaign-send` (lógica de envio Meta Cloud
  API JÁ existente — não foi reescrita).
- `APP_MODE=worker-leads` — `node dist/workers/leads-worker.js`. Consome a
  fila `leads-bulk` (operações em massa de Deals: `bulk-update-fields`,
  `bulk-move-stage`).

No EasyPanel, criar 3 serviços apontando para o MESMO repositório/imagem,
diferenciados apenas pela env `APP_MODE`. Todos compartilham `DATABASE_URL`,
`REDIS_URL`, `NEXTAUTH_*` etc. — workers só precisam do subconjunto que usam,
mas sem prejuízo se receberem todas.

**Contexto.** Antes desta mudança, o Dockerfile só subia `node server.js`.
O `campaign-worker.ts` existia mas não tinha script npm nem branch no
entrypoint — campanhas enfileiravam jobs que ninguém consumia em produção,
a menos que alguém executasse `tsx src/workers/campaign-worker.ts` manualmente
em outro processo. Quando o usuário pediu BullMQ workers, descobrimos que
~95% da infra já existia; o gap era operacional (deploy + ergonomia).

**Por que esbuild compila os workers em vez de usar `tsx` em prod.** O runner
stage do Dockerfile copia apenas `.next/standalone`, que é o output do Next
trace — ele inclui só pacotes que o bundle Next referencia em runtime. `tsx`
(em `dependencies` no package.json) NÃO é referenciado pelo Next e portanto
não é copiado para o runner. `npm run build:workers` (`scripts/build-workers.mjs`)
usa esbuild para empacotar `campaign-worker.ts` e `leads-worker.ts` em CJS
standalone, externalizando `@prisma/client` (que precisa vir dos engines
nativos copiados em `node_modules/@prisma/*`). Dev local mantém `tsx` por
ergonomia (sem rebuild a cada edit) — scripts `start:worker:*` (dev) vs
`start:worker:*:prod` (Docker).

**Por que migrations só em APP_MODE=api.** Se workers também aplicassem
`prisma migrate deploy`, três serviços competiriam pelo mesmo lock de
migration no Postgres em cada deploy. O serviço API é o "owner" das migrations;
workers assumem que o schema está pronto. Em ambientes `SKIP_PRISMA_MIGRATE=1`
(test apontando para banco do monólito), nem o API aplica — operador roda
manual via `psql`.

**Alternativas descartadas.**

- **Dockerfile.worker separado.** Imagem por papel é mais enxuta mas dobra
  complexidade de CI/registry e desincroniza versões entre API e worker.
  Uma imagem só com `APP_MODE` é mais simples para o tamanho atual do projeto.
- **Migrations dentro do worker.** Levaria a race condition se 3 serviços
  do mesmo deploy subissem em paralelo. Mesmo com `IF NOT EXISTS` no SQL,
  o `_prisma_migrations` table não tolera concorrência limpa.
- **Rodar workers in-process do Next API.** Já fazemos isso para timers leves
  (`sse-bus.ts` bootstrap), mas BullMQ Workers ocupam um event loop e
  competiriam com requests HTTP. Processos separados isolam falhas (worker
  morto não derruba a API) e permitem scaling independente.

---

### 2026-05-22 — BulkOperation: Postgres como fonte da verdade do progresso

**Decisão.** Operações em massa enfileiradas no BullMQ registram seu estado
em uma tabela `bulk_operations` no Postgres (modelo `BulkOperation`). O Redis
mantém apenas o job na fila enquanto está sendo processado; todo histórico,
progresso, erros e auditoria vivem no Postgres.

Endpoints criados:

- `POST /api/deals/bulk` — modo async opt-in (flag `async: true` no body,
  ou auto-async se `dealIds.length > 50`) para `action: "move_stage"`. Outras
  ações (change_owner, mark_won, mark_lost, delete) continuam síncronas por
  enquanto.
- `POST /api/deals/bulk/custom-fields` — NOVA funcionalidade (não existia
  bulk de custom fields antes), sempre async, com `BulkOperation` tracking.
- `GET /api/bulk-operations/[id]` — frontend pollar progresso via
  `{ total, processed, succeeded, failed, progressPercent, errors[] }`.

Idempotência: a Prisma extension de scope filtra todas as queries por
`organizationId`. Workers usam `withSystemContext(orgId, ...)` para
configurar o AsyncLocalStorage antes de invocar handlers que usam `prisma`
(scoped). `_update-progress.ts` usa `prismaBase` (sem scope) para atualizar
o `BulkOperation` — evita acoplamento com a extension nos workers compilados.

**Contexto.** O backend tinha 5 filas BullMQ em produção, mas nenhum modelo
para rastrear estado de operações em massa fora do escopo de campanhas
WhatsApp (que tem seu próprio modelo `Campaign` + `CampaignRecipient`). Para
operações de Deals em lote, faltava completamente um trilho — `POST
/api/deals/bulk` rodava 100% síncrono com loops N+1.

**Por que não usar apenas o estado do BullMQ.** O BullMQ remove jobs com
`removeOnComplete: true` (default no projeto). Sem snapshot em DB, o
histórico se perde — impossível responder "que bulk operations rodaram nessa
org no último mês?". Além disso, polling do frontend ficaria amarrado ao
Redis estar acessível pela rota API, o que dobra a superfície de
dependência.

**Cuidado 7 do enunciado (idempotência + fire-and-forget):**

- `bulk-move-stage` reverifica `stageId !== target` antes de cada update.
  Deals já na stage destino são contados como sucesso sem disparar
  `DealEvent` ou `fireTrigger`. Retry do job não reaplica triggers.
- `updateMany` atômico por chunk de 50 deals. Side effects (`createDealEvent`,
  `fireTrigger`) ficam fora da transação principal — fire-and-forget com log,
  igual ao helper síncrono `moveDeal` em `services/deals.ts`.
- Erros por-deal são acumulados em `BulkOperation.errors` (JSON array) com
  cap de 500 entradas. Worker continua processando os demais deals do chunk.
- Re-throw acontece apenas em erros de infraestrutura (DB down) que causam
  retry do job inteiro pelo BullMQ.

---

### 2026-05-14 — User movido entre orgs: gera registros órfãos sob RLS

**Decisão.** Sempre que um `User` for movido entre `Organization`s (campo
`organizationId` no `users`), TODOS os registros 1:1 que carregam
`organizationId` denormalizado precisam ser atualizados na mesma transação,
ou Prisma RLS começa a devolver `P2025`/`P2003` em loop nos heartbeats.

Tabelas afetadas conhecidas:

- `agent_statuses` (1:1 com user, indexado por `userId @unique`)
- *(adicionar aqui qualquer outra tabela com `organizationId + userId@unique`
  que aparecer no futuro)*

**Contexto.** Descoberto investigando `prisma.agentStatus.upsert()` em loop
no log do backend separado. O user `adm@dnawork.ai` foi originalmente
criado em `org_eduit` e depois movido para `org_dnawork`. O registro
`agent_statuses` ficou com `organizationId = org_eduit`. Quando o user
faz heartbeat:

1. Sessão tem `organizationId = org_dnawork` (org atual do user).
2. Prisma extension de RLS injeta `WHERE organizationId = 'org_dnawork'`
   no `findUnique` interno do upsert.
3. Não acha o registro (que existe, mas em outra org).
4. Vai pro `create` path.
5. Conflita em `userId @unique` (já existe um registro com esse userId).
6. Prisma normaliza isso como `P2025: Record not found`.

A produção do monólito (`crm.eduit.com.br`) provavelmente não tinha esse
loop antes porque rodava com Prisma extension RLS desativado, ou
processava cross-org sem filtrar (super-admin path).

**Como detectar.**

```bash
DATABASE_URL=... node scripts/diagnose-agent-status.mjs
```

Mostra registros cross-org. Se houver, rodar:

```bash
DATABASE_URL=... node scripts/fix-agent-status-cross-org.mjs
```

(move cada AgentStatus pra `organizationId` igual ao do user dono).

**Alternativas descartadas.**

- **Cascade deletar AgentStatus quando user muda de org.** Perde
  histórico de presença e o user fica "OFFLINE" até próximo ping. Pior UX.
- **Remover o `organizationId` redundante de `agent_statuses`.** O index
  por org existe pra performance de dashboards multi-tenant (listar todos
  agentes ONLINE de uma org). Tirar quebraria essas queries.

**Impacto.**

- Hardening defensivo aplicado em `PUT /api/agents/[id]/status` (igual ao
  já existente em `POST /api/agents/me/ping`): captura `P2025/P2003`,
  responde 200 silenciosamente. Não polui log nem quebra UX se voltar a
  aparecer registro órfão.
- TODO técnico: encontrar e bloquear o lugar do código que **move user
  entre orgs** (super-admin tool) e adicionar transação que atualize
  `agent_statuses.organizationId` em conjunto. Sem isso, novos órfãos
  podem nascer.

### 2026-05-14 — Sem Redis em ambiente de teste compartilhado com produção

**Decisão.** No ambiente de teste no Easypanel
(`banco-backend-crm.6tqx2r.easypanel.host`), o backend separado roda **sem
Redis**. As envs `REDIS_URL` e `SSE_ENABLE_REDIS_PUBSUB` ficam ausentes.
Cache, rate-limit e SSE pub/sub usam o fallback em memória que já existe
no código.

**Contexto.** O Redis disponível na infra atual está no project
"banco" (junto do Postgres) e é **o mesmo Redis usado pelo monólito de
produção** em `crm.eduit.com.br`. Dois pontos:

1. Hostname interno do Docker (`banco_redis-crm`) **não resolve cross-project**
   no Easypanel — só dentro do mesmo project. Daí o
   `getaddrinfo ENOTFOUND banco_redis-crm` no backend separado.
2. Mesmo se conseguíssemos conectar (expondo Redis externamente ou
   movendo de project), **compartilhar Redis com produção é inaceitável**:
   cache de `Organization`/feature flags/subscription colide, SSE
   entrega eventos cruzados entre teste e produção, rate-limit do
   teste consome budget da produção. Risco real de cache poisoning
   em produção por conta de um ambiente de teste.

**Alternativas descartadas.**

- **Expor Redis externamente e compartilhar com produção.** Inseguro
  (Redis com auth fraca é vetor comum de ransomware) e contamina
  produção (ver acima).
- **Subir um Redis novo no project do backend separado.** Funciona, mas
  é overhead pra um ambiente que é só validação de UI/login. Reservado
  para o deploy real em VPS de cliente final.

**Impacto.**

- Cache 100% em memória → válido enquanto for 1 réplica do backend
  (que é o caso atual). Escalar pra 2+ réplicas exige Redis dedicado.
- SSE entrega eventos só para conexões na **mesma instância** do
  backend — também ok pra 1 réplica.
- Rate-limit por IP/user fica per-instance — fine pra teste.
- Em deploy de cliente final (VPS nova): criar Redis dedicado no mesmo
  project do backend e setar `REDIS_URL=redis://default:SENHA@{project}_{redis}:6379`
  e `SSE_ENABLE_REDIS_PUBSUB=1`.

### 2026-05-14 — Backend aponta para `db_crm` com `SKIP_PRISMA_MIGRATE=1`

**Decisão.** No ambiente de teste no Easypanel
(`banco-backend-crm.6tqx2r.easypanel.host`), o backend separado se conecta
**ao mesmo banco `db_crm`** que o monólito de produção (`crm.eduit.com.br`),
com `SKIP_PRISMA_MIGRATE=1` no entrypoint para evitar tentar aplicar a baseline
nova em um banco já populado.

**Contexto.** O `db_crm` em `187.127.27.39:5432` já tem schema multi-tenant
completo (71 tabelas, 60 migrations registradas) e dados reais de produção
(16 users, 3 organizations, 260 conversations, 915 messages). O backend
separado nasceu com a baseline `20240101000000_init` gerada via
`prisma migrate diff --from-empty`. Como `_prisma_migrations` do `db_crm`
não conhece essa baseline (e o reverso: o repo do backend não tem 2
migrations `20260429*_add_contact_ad_tracking` que existem no `db_crm`),
deixar o `prisma migrate deploy` rodar no boot quebra (tenta aplicar
baseline e dá `relation already exists`). O drift de schema é só
cosmético (índices/defaults) — todas as colunas que o `schema.prisma`
referencia existem no `db_crm`.

**Alternativas descartadas.**

- **Criar banco novo zerado e seed.** Perde os dados reais e os 16 users
  existentes — todos os testes contra produção e sessões ativas viriam abaixo.
- **Forçar drop + reaplicar baseline no `db_crm`.** Destrutivo demais para
  banco que ainda é usado pelo monólito em produção. Risco real de perder
  conversas e tickets ativos.
- **Reconciliar histórico de migrations.** Editar `_prisma_migrations` à mão
  pra alinhar com o repo é frágil e dificil de auditar; `SKIP_PRISMA_MIGRATE=1`
  é mais seguro até o cutover definitivo.

**Impacto.**

- Para qualquer deploy do backend separado contra o **mesmo banco do monólito**,
  setar `SKIP_PRISMA_MIGRATE=1` no env do Easypanel é obrigatório.
- Quando subir em VPS nova com banco zerado (cenário cliente final), **NÃO**
  setar `SKIP_PRISMA_MIGRATE`. O entrypoint vai aplicar a baseline + 58
  migrations subsequentes normalmente.
- Drift entre repo e `db_crm` precisa ser reconciliado antes do cutover
  definitivo: capturar as 2 migrations `add_contact_ad_tracking` do
  `db_crm` para o repo, gerar nova baseline, dropar o `_prisma_migrations`
  no `db_crm` e re-marcar tudo como aplicado (single-shot, em janela de
  manutenção).

### 2026-05-14 — Não listar `NEXTAUTH_URL` em `next.config.ts > env`

**Decisão.** O bloco `env: { NEXTAUTH_URL: ... }` foi removido do
`next.config.ts` do backend. `process.env.NEXTAUTH_URL` é lido em runtime
de verdade.

**Contexto.** Em Next.js, qualquer variável listada no `env` do
`next.config.ts` é **inlineada como string literal no bundle em build time**.
Para um backend que só serve API (sem `next-auth/react` no client), esse
inline não tem benefício e cria uma armadilha: o build do Easypanel
capturou `NEXTAUTH_URL=http://localhost:3000` (fallback) e ficou imune
a trocar a env no painel sem rebuild. Sintomas observados:

- Cookie de sessão emitido sem prefixo `__Secure-` e sem flag `Secure`,
  porque `useSecureCookies = nextAuthUrl.startsWith("https://")` viu o
  inlined `"http://..."` e calculou `false`.
- `Location` no 302 pós-login apontava para `http://localhost:3000`.
- Middleware Edge do frontend procurava `__Secure-authjs.session-token`
  e não achava → redirect infinito pra `/login`.

**Alternativas descartadas.**

- **Manter o bloco e setar `NEXTAUTH_URL` em build-args do Docker.** Fica
  refém de o build sempre rodar com o env correto, e qualquer rebuild com
  env errada (cenário Easypanel real) volta a quebrar silenciosamente.
- **Hardcoded em `auth.config.ts`.** Pior — vira release-blocker em cada
  ambiente diferente.

**Impacto.** Trocar `NEXTAUTH_URL` no painel agora exige apenas
**Restart** (não Rebuild). Cookie passa a sair com `__Secure-` + flag
`Secure` quando atrás de HTTPS, exatamente como o middleware Edge do
frontend espera ler via `getToken({ secureCookie: true })`.

---

### 2026-05-14 — Re-fork a partir do `main` multi-tenant (`pre-update-multitenant` → `multi-tenant`)

**Decisão.** Os repositórios `frontend_crm1` e `backend_crm1` foram **regenerados
a partir do zero** usando como fonte o `main` atual do monólito original
(`mfpi1209/crm`). O fork anterior (de `e78c979`, branch `split-frontend-backend`,
tag `pre-update-multitenant` em ambos os repos) era um snapshot **single-tenant**,
desatualizado em **248 commits** em relação ao `main` no momento da separação.

**Contexto.** A separação inicial (anterior a 2026-05-14) foi feita a partir de
`e78c979`, um ponto no monólito **antes** da implementação de multi-tenancy
(`Organization` + `OrganizationFeatureFlag` + `OrganizationSubscription` + RLS),
MFA, audit log, billing/Stripe, WhatsApp Flow Builder, AuthZ scope grants, e
~240 outros commits de evolução. Como o produto comercial precisa rodar em
multi-tenant (cada cliente = uma `Organization`), continuar evoluindo o fork
single-tenant era inviável.

Repos antes do re-fork (tagueados como `pre-update-multitenant`):
- `backend_crm1@5ed72ce` — single-tenant baseline gerada em 2026-05-14.
- `frontend_crm1@3b8a940` — Dockerfile inicial.

**Alternativas descartadas.**

- **Merge `main` na `split-frontend-backend` do monólito.** Rebase de 248
  commits em cima de um fork que **já removeu** partes do código geraria
  conflito em centenas de arquivos. Cada commit do main toca paths que o
  fork não tem mais (ou tem em outra forma), exigindo resolução manual
  arquivo por arquivo. Custo alto, risco de regressão silenciosa.

- **Continuar evoluindo o fork single-tenant.** Tecnicamente possível, mas
  significa reescrever toda a multi-tenancy de novo dentro do fork — duplicação
  de trabalho e provável divergência permanente do produto principal. O custo
  de oportunidade é o de NÃO ter os features que já existem no main (MFA,
  audit, billing, etc.).

- **Manter o monólito como single-source e fazer separação via reverse-proxy.**
  Não atende ao requisito de deploy independente em VPS diferentes para futuros
  clientes. O usuário definiu que o produto final será multi-VPS.

**Procedimento (idempotente; ver `fork-strategy.mjs` na raiz do workspace).**

1. **Salvaguardas.** Tags `pre-update-multitenant` push'adas em
   `backend_crm1` e `frontend_crm1`. Tag `pre-split-redo-2026-05-14` local no
   monólito (na branch `split-frontend-backend` em `e78c979`).
2. **Atualização do monólito local.** `git checkout main && git pull` para
   trazer todos os 248 commits.
3. **Wipe controlado.** Em cada repo destino, todo conteúdo é apagado
   **exceto** os arquivos exclusivos da separação (Dockerfile,
   `docker-entrypoint.sh`, `.env.example`, `package.json`, scripts de
   manutenção, `src/lib/api.ts`, `src/lib/auth-public.ts`, etc.). A lista
   completa fica no array `PRESERVE` do `fork-strategy.mjs`.
4. **Copy whitelist.** Apenas os paths classificados como "backend" (ou
   "frontend") são copiados do monólito atualizado. Lista no array
   `COPY_FROM_MONOLITH`.
5. **Limpeza no frontend.** Após copiar `src/lib/`, arquivos `server-only`
   (`prisma.ts`, `queue.ts`, `auth.ts`, `audit/`, `billing/`, etc.) são
   removidos do frontend (lista em `FRONTEND_LIB_BLACKLIST`).
6. **`patch-api-urls.mjs`.** Roda no frontend para transformar
   `fetch("/api/...")` em `fetch(apiUrl("/api/..."))`, garantindo que as
   chamadas client-side cheguem ao backend mesmo quando ele está em outro
   host (configurável via `NEXT_PUBLIC_API_BASE_URL`).
7. **Baseline multi-tenant.** `prisma/migrations/20240101000000_init/`
   regerada via `prisma migrate diff --from-empty --to-schema-datamodel`
   (70 tabelas, 33 enums, ~250 índices — vs 53 tabelas / 27 enums da
   versão single-tenant).
8. **Banco staging.** Schema `public` dropado e recriado; baseline
   aplicada; as 58 migrations posteriores marcadas como aplicadas
   (`resolve --applied`).

**Impacto.**

1. `frontend_crm1` e `backend_crm1` passam a ser **os únicos repositórios
   ativos** do produto. O monólito `mfpi1209/crm` torna-se referência
   histórica apenas (read-only, sem deploy).
2. Qualquer cliente novo daqui pra frente sobe os dois containers (front
   + back) em um Easypanel próprio + banco próprio, criando sua
   `Organization` via wizard de signup público.
3. Banco staging atual (`banco@187.127.27.39`) foi recriado do zero com
   schema multi-tenant. **Contas anteriores foram perdidas no staging**
   (eram fixtures de teste, sem dados reais). A produção
   `crm.eduit.com.br` continua intocada — roda no monólito original.
4. Próximos features são desenvolvidos diretamente em `backend_crm1` ou
   `frontend_crm1`, sem voltar pro monólito.

---

### 2026-05-14 — Migration de baseline (`20240101000000_init`) [DEPRECADO — substituída pela versão multi-tenant]

**(Entrada original sobre a baseline single-tenant gerada no início do dia. Mantida
para referência histórica. A baseline atual em `prisma/migrations/` é a
multi-tenant gerada após o re-fork.)**

Decisão original: adicionada a migration `20240101000000_init/migration.sql`
para destravar `P3009` em bancos novos vazios. A versão single-tenant tinha
27 enums + 53 tabelas. A nova versão multi-tenant (após re-fork) tem 33 enums
+ 70 tabelas. Scripts utilitários (`scripts/clean-failed-migrations.mjs`,
`scripts/resolve-post-baseline.mjs`, etc.) continuam válidos e ficam mantidos
para recuperar futuros bancos que caiam em P3009.
