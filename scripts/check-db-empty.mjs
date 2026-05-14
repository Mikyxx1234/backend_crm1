// Verifica se o banco está realmente vazio (apenas _prisma_migrations + extensões)
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL ausente");
  process.exit(2);
}
const c = new Client({ connectionString: url });
await c.connect();

const tables = await c.query(`
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename
`);
console.log(`Tabelas em public (${tables.rows.length}):`);
for (const r of tables.rows) console.log(`  - ${r.tablename}`);

console.log("");

const views = await c.query(`
  SELECT viewname FROM pg_views WHERE schemaname='public'
`);
console.log(`Views: ${views.rows.length}`);

const types = await c.query(`
  SELECT typname FROM pg_type t
  JOIN pg_namespace n ON n.oid=t.typnamespace
  WHERE n.nspname='public' AND t.typtype='e'
`);
console.log(`Enums: ${types.rows.length}`);
for (const r of types.rows) console.log(`  - ${r.typname}`);

await c.end();
