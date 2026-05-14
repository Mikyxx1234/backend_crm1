// Diagnóstica todas as condições que o `authorize()` do auth.ts verifica
// pra entender por que um login pode estar sendo rejeitado mesmo com
// senha correta.
import { Client } from "pg";

const [, , email] = process.argv;
if (!email) { console.error("Uso: node scripts/diagnose-user.mjs <email>"); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL não setado."); process.exit(1); }

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const u = (await c.query(
  `SELECT id, email, name, role, type, "isErased", "isSuperAdmin",
          "mfaSecret" IS NOT NULL AS has_mfa_secret,
          "mfaEnabledAt", "organizationId", "hashedPassword" IS NOT NULL AS has_password
   FROM users WHERE email = $1`, [email],
)).rows[0];

if (!u) { console.error("User não encontrado."); await c.end(); process.exit(2); }
console.log("=== Estado do user ===");
console.log({ id: u.id, email: u.email, role: u.role, type: u.type, has_password: u.has_password, isErased: u.isErased, isSuperAdmin: u.isSuperAdmin, organizationId: u.organizationId, has_mfa_secret: u.has_mfa_secret, mfaEnabledAt: u.mfaEnabledAt });

console.log("\n=== Checks do authorize() ===");
console.log("type === 'AI'? ", u.type === "AI", "→", u.type === "AI" ? "BLOQUEIA" : "OK");
console.log("hashedPassword vazio?", !u.has_password, "→", !u.has_password ? "BLOQUEIA" : "OK");
console.log("isErased?", u.isErased, "→", u.isErased ? "BLOQUEIA" : "OK");
console.log("MFA habilitada?", Boolean(u.mfaSecret && u.mfaEnabledAt), "→", (u.has_mfa_secret && u.mfaEnabledAt) ? "EXIGE CÓDIGO MFA" : "OK");
console.log("organizationId vazio + não-superAdmin?", !u.organizationId && !u.isSuperAdmin, "→", (!u.organizationId && !u.isSuperAdmin) ? "BLOQUEIA" : "OK");

if (u.organizationId) {
  const org = (await c.query(`SELECT id, name, status FROM organizations WHERE id = $1`, [u.organizationId])).rows[0];
  console.log("\nOrganização:", org);
  console.log("Status != ACTIVE?", org?.status !== "ACTIVE", "→", org?.status !== "ACTIVE" ? "BLOQUEIA" : "OK");
}

console.log("\n=== Lockout / tentativas recentes ===");
try {
  const att = await c.query(
    `SELECT outcome, "createdAt" FROM login_attempts WHERE email = $1 ORDER BY "createdAt" DESC LIMIT 8`,
    [email],
  );
  console.log(`${att.rowCount} tentativas recentes:`);
  att.rows.forEach((r, i) => console.log(`  ${i + 1}. [${r.createdAt.toISOString()}] ${r.outcome}`));
  const recentFails = att.rows.filter((r) => ["bad_password", "no_user", "locked", "bad_mfa", "mfa_required"].includes(r.outcome)).length;
  console.log(`Falhas recentes: ${recentFails}`);
} catch (e) { console.log("(sem tabela login_attempts ou erro:", e.message, ")"); }

await c.end();
