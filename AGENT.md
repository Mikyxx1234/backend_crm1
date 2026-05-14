# Decisões Estruturais — CRM EduIT (Backend)

Registro de decisões técnicas que afetam estrutura do projeto. Cada entrada
documenta **por que** algo foi feito, não **o que**.

---

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
