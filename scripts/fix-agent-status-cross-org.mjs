// Corrige AgentStatus com organizationId desalinhado do User dono.
// Para cada AgentStatus onde a.organizationId <> users.organizationId,
// move o AgentStatus para a org correta (a do user).
//
// Causa típica: user foi movido de uma org para outra; o AgentStatus
// nasceu na primeira e ficou órfão. Resultado: heartbeat (`upsert`) dá
// `P2025 Record not found` em loop sob RLS.
import { Client } from "pg";
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL não setado."); process.exit(1); }

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const orphans = (await c.query(`
  SELECT a.id, a."userId", u.email,
         a."organizationId" AS as_org, u."organizationId" AS user_org
  FROM agent_statuses a
  INNER JOIN users u ON u.id = a."userId"
  WHERE a."organizationId" <> u."organizationId"
`)).rows;

console.log(`AgentStatuses cross-org encontrados: ${orphans.length}`);
console.table(orphans);

if (orphans.length === 0) {
  await c.end();
  process.exit(0);
}

console.log("\nMovendo cada registro para a org do user dono…");
for (const o of orphans) {
  // Antes de mover, garantir que NÃO existe outro AgentStatus com o mesmo
  // userId na org de destino (que provocaria conflito de @unique).
  const dup = (await c.query(
    `SELECT id FROM agent_statuses WHERE "userId" = $1 AND "organizationId" = $2 AND id <> $3`,
    [o.userId, o.user_org, o.id],
  )).rows;
  if (dup.length > 0) {
    console.log(`  [skip] ${o.email}: já existe outro AgentStatus(${dup[0].id}) na org destino. Apague um manualmente.`);
    continue;
  }
  const r = await c.query(
    `UPDATE agent_statuses SET "organizationId" = $1 WHERE id = $2 RETURNING id, "organizationId"`,
    [o.user_org, o.id],
  );
  console.log(`  [ok]   ${o.email}: ${o.as_org} → ${o.user_org}  (id=${r.rows[0].id})`);
}

await c.end();
