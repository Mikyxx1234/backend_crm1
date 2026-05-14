# Decisões Estruturais — CRM EduIT

Registro de decisões técnicas que afetam estrutura do projeto, conforme regra
de governança em `.cursor/rules/`. Cada entrada documenta **por que** algo foi
feito, não **o que**.

---

### 2026-05-14 — Migration de baseline (`20240101000000_init`)

**Decisão.** Adicionada a migration `prisma/migrations/20240101000000_init/migration.sql`
contendo o `CREATE SCHEMA` + 27 enums + 53 `CREATE TABLE` do schema atual.
Gerada via `npx prisma migrate diff --from-empty --to-schema-datamodel`.

**Contexto.** Ao separar o monólito em dois repos (`frontend_crm1` e
`backend_crm1`) e subir o backend em um banco novo/vazio no Easypanel
(`banco@187.127.27.39`), o `prisma migrate deploy` quebrava com `P3009` na
primeira migration (`20260329_add_last_inbound_at`) porque ela tentava
`ALTER TABLE "conversations" ADD COLUMN ...` numa tabela que nunca tinha
sido criada. Causa raiz: o histórico em `prisma/migrations/` **nunca tinha
uma baseline** — todas as 41 migrations eram evoluções (`ALTER`/`ADD COLUMN`/
`CREATE INDEX`) que assumiam o schema inicial já existente. No banco antigo
(`db_crm_dev`) isso funcionava porque o schema havia sido criado via
`prisma db push` antes do histórico de migrations passar a ser versionado.

**Alternativas descartadas.**

- **`prisma db push --accept-data-loss` em produção.** Rápido mas é o mesmo
  "fallback tóxico" que o comentário do `start.sh` (linhas 10–15) documenta
  como removido em abril/26: mascarava bugs e deixava `_prisma_migrations`
  fora de sincronia com o schema real. Adicionar de volta seria regressão.

- **Reconstituir o schema antigo (pré-`20260329`) como baseline.** Exigiria
  reverter mentalmente todas as 41 migrations para gerar o estado original,
  o que é trabalhoso e pode introduzir bugs sutis. Em compensação preservaria
  o histórico "narrativo" das migrations. Como o histórico só passou a ser
  versionado em março/26 (já com schema maduro), o ganho narrativo é baixo.

**Impacto.**

1. Qualquer banco novo a partir de agora — staging, segundo cliente,
   ambiente de teste — sobe com `migrate deploy` sem intervenção manual.
2. As 41 migrations posteriores à baseline tornam-se historicamente
   redundantes (a baseline já contém o estado final). Para bancos
   pré-existentes ao baseline (qualquer instância criada antes de
   `2026-05-14`), as 41 já estarão marcadas como aplicadas em
   `_prisma_migrations`. Para bancos novos, o `migrate deploy` aplica a
   baseline e em seguida pula as 41 (porque os objetos já existem) — mas
   isso **falha** com `42701 column already exists`. Por isso, para bancos
   pré-existentes ao baseline (caso desta correção em produção), foi
   necessário marcar manualmente as 41 como aplicadas via
   `prisma migrate resolve --applied <nome>` após criar a baseline.
3. O fluxo padrão de criar nova migration (`prisma migrate dev`) **continua
   funcionando normalmente** — qualquer `ALTER` futuro vira uma nova
   migration após a baseline e roda em todos os ambientes.

**Procedimento aplicado em produção (`banco@187.127.27.39`):**

```bash
# 1. Limpar entradas falhadas em _prisma_migrations (banco estava vazio)
node scripts/clean-failed-migrations.mjs

# 2. Aplicar baseline (cria 53 tabelas + 27 enums)
npx prisma migrate deploy --schema=./prisma/schema.prisma

# 3. Marcar as 41 evoluções como aplicadas (já contidas na baseline)
node scripts/resolve-post-baseline.mjs

# 4. Validar
npx prisma migrate status --schema=./prisma/schema.prisma
# > "Database schema is up to date!"
```

Scripts utilitários ficam em `scripts/` para uso futuro caso seja preciso
recuperar outro banco que tenha caído em P3009.
