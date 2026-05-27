# scripts/dev

Scripts utilitários de desenvolvimento local. **Nunca rode em produção.**

## `check-db.mjs`

Inspeção rápida do estado do banco (contagens, IDs principais).

```bash
node scripts/dev/check-db.mjs
```

## `create-local-admin.mjs`

Cria/atualiza um usuário admin local na organização `EduIT Local`.

```bash
LOCAL_ADMIN_PASSWORD=trocar123 node scripts/dev/create-local-admin.mjs
```

Variáveis opcionais:

- `LOCAL_ADMIN_EMAIL` (default `admlocal@eduit.com.br`)
- `LOCAL_ADMIN_NAME` (default `Admin Local`)

## `seed-local-mockup.mjs`

Popula o banco local com dados de demonstração (pipelines, contatos, deals, conversas).

```bash
node scripts/dev/seed-local-mockup.mjs
```

> Requer `DATABASE_URL` apontando para o banco local.
