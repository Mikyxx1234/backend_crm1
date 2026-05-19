/**
 * Aplica os índices novos do Kanban direto na base.
 * Usar quando o `prisma migrate deploy` não conseguir (histórico
 * dessincronizado).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import pg from "pg";

const sql = readFileSync(
  resolve(process.cwd(), "prisma/migrations/20260519110000_kanban_filter_indexes/migration.sql"),
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
  // não envolver em uma única transação — alguns índices podem falhar e
  // queremos os outros aplicados. Cada CREATE IF NOT EXISTS é idempotente.
  await client.query(sql);
  console.log("Índices aplicados com sucesso.");
} catch (err) {
  console.error("Falha:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
