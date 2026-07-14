/**
 * Script de ativacao gradual do Row-Level Security (Fase 5 do plano
 * de correcoes de seguranca).
 *
 * PRE-REQUISITOS (fazer ANTES de rodar em qualquer ambiente real):
 *
 *   1. `npm run test:isolation` verde em staging (com o role app_runtime
 *      apontado por DATABASE_URL — nao com o owner das migrations).
 *   2. Confirmar que TODAS as requisicoes reais estao setando GUCs
 *      `app.organization_id`/`app.is_super_admin` — atraves da Prisma
 *      extension + `withSystemContext` para jobs/webhooks. Se alguma
 *      request rodar sem GUC no role sem BYPASSRLS, TODAS as policies
 *      bloqueiam (SELECT retorna vazio, INSERT falha) e a UI quebra.
 *   3. Role `app_runtime` criada e configurada como documentado em
 *      `prisma/sql/setup-app-runtime-role.sql`.
 *
 * COMO RODAR:
 *
 *   # Habilita RLS em UMA tabela especifica (recomendado para o piloto):
 *   npx tsx scripts/enable-rls.ts contacts
 *
 *   # Habilita RLS em TODAS as tabelas de RLS_PROTECTED_TABLES:
 *   npx tsx scripts/enable-rls.ts --all
 *
 *   # Dry-run: apenas lista o que seria feito, sem tocar no schema.
 *   npx tsx scripts/enable-rls.ts --all --dry-run
 *
 * ROLLBACK POR TABELA:
 *
 *   psql "$DATABASE_URL" -c 'ALTER TABLE contacts DISABLE ROW LEVEL SECURITY;'
 *
 * NAO faz drop das policies — elas permanecem para reativacao futura.
 */

import { prismaBase } from "../src/lib/prisma-base";
import { enableRlsOnTable, RLS_PROTECTED_TABLES } from "../src/lib/rls";

type Args = {
  all: boolean;
  dryRun: boolean;
  table: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { all: false, dryRun: false, table: null };
  for (const a of argv) {
    if (a === "--all") args.all = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (!a.startsWith("--") && !args.table) args.table = a;
  }
  return args;
}

async function assertRlsActive(tableName: string): Promise<void> {
  const rows = await prismaBase.$queryRawUnsafe<
    Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
  >(
    `SELECT relrowsecurity, relforcerowsecurity
       FROM pg_class
      WHERE oid = $1::regclass`,
    tableName,
  );
  if (!rows[0]?.relrowsecurity || !rows[0]?.relforcerowsecurity) {
    throw new Error(
      `RLS nao ficou ativo em ${tableName} (rowsecurity=${rows[0]?.relrowsecurity}, force=${rows[0]?.relforcerowsecurity})`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets: readonly string[] = args.all
    ? RLS_PROTECTED_TABLES
    : args.table
      ? [args.table]
      : [];

  if (targets.length === 0) {
    console.error(
      "Uso: enable-rls.ts <tabela> | --all [--dry-run]\n" +
        "Tabelas conhecidas: " +
        RLS_PROTECTED_TABLES.join(", "),
    );
    process.exit(1);
  }

  const unknown = targets.filter(
    (t) => !RLS_PROTECTED_TABLES.includes(t as (typeof RLS_PROTECTED_TABLES)[number]),
  );
  if (unknown.length > 0) {
    console.error(`Tabelas nao registradas em RLS_PROTECTED_TABLES: ${unknown.join(", ")}`);
    process.exit(1);
  }

  console.log(
    `[enable-rls] ${args.dryRun ? "(DRY-RUN) " : ""}Ativando RLS em ${targets.length} tabela(s):`,
  );
  for (const t of targets) console.log(`  - ${t}`);

  if (args.dryRun) {
    console.log("[enable-rls] dry-run: nada foi alterado.");
    return;
  }

  for (const table of targets) {
    console.log(`[enable-rls] ${table}: habilitando...`);
    await prismaBase.$transaction(async (tx) => {
      await enableRlsOnTable(tx, table);
    });
    await assertRlsActive(table);
    console.log(`[enable-rls] ${table}: OK`);
  }

  console.log("[enable-rls] Concluido. Rode uma amostra de queries por tenant para validar.");
}

main()
  .catch((err) => {
    console.error("[enable-rls] Falhou:", err);
    process.exit(1);
  })
  .finally(() => prismaBase.$disconnect());
