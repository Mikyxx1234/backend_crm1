/**
 * Fase 3 da migração DEV_BRANCH → main.
 *
 * Aplica em sequência, e de forma idempotente, as 12 migrations Prisma
 * que faltam no banco de produção (11 da DEV_BRANCH + 1 nova de
 * backfill de permissions). Cada arquivo .sql é envolvido numa
 * transação BEGIN/COMMIT — se qualquer statement falhar, o ROLLBACK
 * impede deixar o banco em estado intermediário e o script aborta.
 *
 * Padrão idempotente herdado do projeto:
 *   - As migrations já usam IF NOT EXISTS / DO blocks com EXCEPTION,
 *     então rerodar em DBs com hotfix manual é seguro.
 *   - O registro em `_prisma_migrations` é feito ao final de cada
 *     arquivo, com ON CONFLICT (id) DO NOTHING para idempotência do
 *     próprio registro.
 *
 * Modos:
 *   --dry-run        → só lista o que faria, NÃO conecta para escrever.
 *   --check          → conecta SOMENTE pra ler `_prisma_migrations`,
 *                      mostra quais das 12 alvo já estão registradas.
 *                      Não escreve nada.
 *   --confirm        → aplica de verdade. Sem essa flag, recusa a
 *                      escrever e pede confirmação explícita.
 *   --only=<name>    → aplica só uma migration por nome (debug).
 *
 * Uso:
 *   $env:DATABASE_URL = "postgres://...";
 *   node scripts/dev/apply-dev-branch-migrations.mjs --check
 *   node scripts/dev/apply-dev-branch-migrations.mjs --confirm
 */
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "prisma", "migrations");

// Ordem cronológica das 12 migrations alvo. NÃO MUDAR — algumas dependem
// das anteriores (ex: capability_mode_overrides referencia catalog_capabilities;
// backfill_catalog_permissions só é seguro depois das tabelas catalog/inventory
// existirem porque depende do estado dos presets).
const TARGETS = [
  "20260611200000_products_multitype",
  "20260611210000_inventory_pool_product_optional",
  "20260612000000_contact_sequential_number",
  "20260612190000_add_channel_default_pipeline",
  "20260612200000_add_contact_tags",
  "20260613130000_catalog_capabilities",
  "20260613140000_event_entity_product",
  "20260614130000_capability_mode_overrides",
  "20260614140000_flow_short_id",
  "20260615120000_role_inherits_from",
  "20260615120100_groups_kommo",
  "20260615120200_backfill_catalog_permissions",
];

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isCheck = args.includes("--check");
const isConfirmed = args.includes("--confirm");
const onlyArg = args.find((a) => a.startsWith("--only="));
const onlyFilter = onlyArg ? onlyArg.split("=")[1] : null;

const url = process.env.DATABASE_URL;
if (!url && !isDryRun) {
  console.error("❌ DATABASE_URL não setado.");
  process.exit(1);
}

if (isDryRun) {
  console.log("=== Dry-run: arquivos que seriam aplicados ===");
  for (const name of TARGETS) {
    if (onlyFilter && name !== onlyFilter) continue;
    const file = path.join(MIGRATIONS_DIR, name, "migration.sql");
    console.log(`  - ${name}  →  ${file}`);
  }
  process.exit(0);
}

const c = new Client({ connectionString: url });
await c.connect();

try {
  // 1. Estado atual: quais migrations já estão registradas
  const migrationsRows = (
    await c.query(
      `SELECT migration_name, finished_at IS NOT NULL AS applied,
              rolled_back_at IS NOT NULL AS rolled_back
         FROM _prisma_migrations`,
    )
  ).rows;
  const appliedSet = new Set(
    migrationsRows.filter((m) => m.applied && !m.rolled_back).map((m) => m.migration_name),
  );

  console.log("\n=== Estado atual em _prisma_migrations (para os alvos) ===");
  for (const name of TARGETS) {
    console.log(`  [${appliedSet.has(name) ? "✓ aplicada" : "✗ pendente"}] ${name}`);
  }

  if (isCheck) {
    console.log("\n✔ Modo --check: nenhuma alteração feita.");
    process.exit(0);
  }

  if (!isConfirmed) {
    console.error(
      "\n❌ Sem --confirm. Para aplicar de verdade, rode:\n" +
        "   node scripts/dev/apply-dev-branch-migrations.mjs --confirm\n" +
        "Ou inspecione antes:\n" +
        "   node scripts/dev/apply-dev-branch-migrations.mjs --check",
    );
    process.exit(2);
  }

  // 2. Aplica em sequência
  let appliedNow = 0;
  let skippedAlreadyApplied = 0;
  for (const name of TARGETS) {
    if (onlyFilter && name !== onlyFilter) continue;

    if (appliedSet.has(name)) {
      console.log(`\n→ ${name}: já está em _prisma_migrations — pulando.`);
      skippedAlreadyApplied++;
      continue;
    }

    const file = path.join(MIGRATIONS_DIR, name, "migration.sql");
    console.log(`\n→ ${name}: aplicando ${file}`);
    const sql = await readFile(file, "utf8");

    // Hash igual ao do prisma migrate (sha256 do conteúdo do SQL)
    const checksum = createHash("sha256").update(sql).digest("hex");
    const id = randomUUID();
    const startedAt = new Date();

    try {
      await c.query("BEGIN");
      await c.query(sql);
      // Registra a migration como aplicada (mesmo schema do prisma migrate deploy).
      await c.query(
        `INSERT INTO _prisma_migrations
           (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
         VALUES ($1, $2, $3, $4, $5, 1)
         ON CONFLICT (id) DO NOTHING`,
        [id, checksum, name, startedAt, new Date()],
      );
      await c.query("COMMIT");
      console.log(`  ✓ aplicada e registrada (id=${id.slice(0, 8)}…)`);
      appliedNow++;
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      console.error(`  ❌ FALHA em ${name}: ${err.message}`);
      console.error("\nABORTANDO. Banco está no estado anterior a esta migration.");
      console.error("Investigue antes de tentar de novo.");
      process.exitCode = 1;
      break;
    }
  }

  console.log(
    `\n=== Resumo: ${appliedNow} aplicada(s) agora, ` +
      `${skippedAlreadyApplied} já estavam aplicadas. ===`,
  );
} catch (e) {
  console.error("❌ Erro:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
