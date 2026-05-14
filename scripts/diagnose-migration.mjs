// Diagnóstico do P3009 — investiga estado da migration travada e da coluna.
// Uso: DATABASE_URL=... node scripts/diagnose-migration.mjs
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERRO: DATABASE_URL não definida no ambiente.");
  process.exit(2);
}

const safe = url.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");
console.log(`>> Conectando em: ${safe}`);

const c = new Client({ connectionString: url });
try {
  await c.connect();
  console.log(">> Conexão OK\n");
} catch (e) {
  console.error("!! Falha de conexão:", e.message);
  process.exit(3);
}

async function q(label, sql) {
  console.log(`---- ${label} ----`);
  try {
    const r = await c.query(sql);
    if (r.rows.length === 0) {
      console.log("(sem linhas)");
    } else {
      console.table(r.rows);
    }
  } catch (e) {
    console.error(`!! ${label} falhou:`, e.message);
  }
  console.log("");
}

await q(
  "2a) registro da migration falhada",
  `SELECT migration_name,
          started_at,
          finished_at,
          applied_steps_count,
          rolled_back_at,
          (logs IS NOT NULL) AS has_logs,
          LEFT(COALESCE(logs, ''), 500) AS logs_preview
   FROM _prisma_migrations
   WHERE migration_name = '20260329_add_last_inbound_at'`
);

await q(
  "2a.bis) todas as migrations com finished_at NULL (pendentes/travadas)",
  `SELECT migration_name, started_at, finished_at, rolled_back_at
   FROM _prisma_migrations
   WHERE finished_at IS NULL
   ORDER BY started_at`
);

await q(
  "2b) coluna lastInboundAt existe?",
  `SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'conversations'
     AND column_name = 'lastInboundAt'`
);

await q(
  "2c) backfill chegou a popular?",
  `SELECT
     COUNT(*) FILTER (WHERE "lastInboundAt" IS NOT NULL)::text AS preenchidas,
     COUNT(*)::text AS total_conversations
   FROM "conversations"`
);

await q(
  "2d) quantas conversations DEVERIAM ter lastInboundAt (têm mensagens IN)",
  `SELECT COUNT(DISTINCT "conversationId")::text AS conversations_com_inbound
   FROM "messages"
   WHERE "direction" = 'in'`
);

await q(
  "2e) últimas 5 migrations aplicadas (referência)",
  `SELECT migration_name, finished_at
   FROM _prisma_migrations
   WHERE finished_at IS NOT NULL
   ORDER BY finished_at DESC
   LIMIT 5`
);

await c.end();
console.log(">> Fim.");
