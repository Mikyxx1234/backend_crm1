/**
 * Aplica a migration `saved_filters` direto na base, sem passar pelo
 * Prisma migrate (histórico está dessincronizado nessa instalação).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import pg from "pg";

const sql = readFileSync(
  resolve(process.cwd(), "prisma/migrations/20260519100000_saved_filters/migration.sql"),
  "utf8",
);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definido.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: false });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("Migration aplicada com sucesso.");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Falha:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
