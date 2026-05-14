// Diagnostica registros em `agent_statuses` que podem estar dando P2025
// quando o backend separado tenta upsert (RLS filtra por organizationId).
//
// Procura:
//   1. AgentStatus cujo userId aponta pra User deletado (FK órfão).
//   2. AgentStatus cujo organizationId não bate com o User.organizationId
//      atual (cross-org — RLS bloqueia upsert).
//   3. Users sem AgentStatus (esperado pra recém-criados, normal).
import { Client } from "pg";
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL não setado."); process.exit(1); }
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

console.log("=== Total de registros em agent_statuses ===");
const tot = (await c.query(`SELECT COUNT(*) AS c FROM agent_statuses`)).rows[0];
console.log("  total:", tot.c);

console.log("\n=== Por organization ===");
const byOrg = (await c.query(`
  SELECT a."organizationId", o.name AS org_name, COUNT(*) AS n
  FROM agent_statuses a
  LEFT JOIN organizations o ON o.id = a."organizationId"
  GROUP BY a."organizationId", o.name
  ORDER BY n DESC
`)).rows;
console.table(byOrg);

console.log("\n=== AgentStatus com User cross-org (potencial P2025 via RLS) ===");
const crossOrg = (await c.query(`
  SELECT a.id AS agent_status_id, a."userId", u.email AS user_email,
         a."organizationId" AS as_org, u."organizationId" AS user_org,
         u.role, u."isErased"
  FROM agent_statuses a
  LEFT JOIN users u ON u.id = a."userId"
  WHERE u.id IS NULL OR a."organizationId" <> u."organizationId"
  ORDER BY u.email NULLS FIRST
`)).rows;
console.table(crossOrg);
if (crossOrg.length === 0) {
  console.log("  (nenhum — bom sinal)");
}

console.log("\n=== AgentStatus com User deletado/erased ===");
const erased = (await c.query(`
  SELECT a."userId", u.email, u."isErased"
  FROM agent_statuses a
  LEFT JOIN users u ON u.id = a."userId"
  WHERE u.id IS NULL OR u."isErased" = true
`)).rows;
console.table(erased);
if (erased.length === 0) {
  console.log("  (nenhum)");
}

await c.end();
