// Remove entradas falhadas de _prisma_migrations no banco prod.
// Só remove migrations cujo finished_at IS NULL — entradas aplicadas não são tocadas.
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL ausente");
  process.exit(2);
}
const c = new Client({ connectionString: url });
await c.connect();

const before = await c.query(
  `SELECT migration_name, started_at, finished_at, rolled_back_at
   FROM _prisma_migrations WHERE finished_at IS NULL`
);
console.log(`>> Entradas com finished_at NULL antes: ${before.rows.length}`);
console.table(before.rows);

const r = await c.query(
  `DELETE FROM _prisma_migrations WHERE finished_at IS NULL RETURNING migration_name`
);
console.log(`>> Removidas: ${r.rowCount} linhas`);

const after = await c.query(
  `SELECT COUNT(*)::int AS total FROM _prisma_migrations`
);
console.log(`>> Total restante em _prisma_migrations: ${after.rows[0].total}`);

await c.end();
