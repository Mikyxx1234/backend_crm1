// Lê o hashedPassword atual do user e tenta dar bcrypt.compare contra
// uma senha candidata, igualzinho ao authorize() do auth.ts faz.
import { Client } from "pg";
import bcrypt from "bcryptjs";

const [, , email, candidate] = process.argv;
if (!email || !candidate) {
  console.error("Uso: node scripts/verify-password.mjs <email> <senhaCandidata>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não setado.");
  process.exit(1);
}

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(
  `SELECT id, email, name, role, "isErased", "hashedPassword" FROM users WHERE email = $1`,
  [email],
);
await c.end();
if (r.rowCount === 0) {
  console.error(`User '${email}' não encontrado.`);
  process.exit(2);
}
const u = r.rows[0];
console.log("User:", { id: u.id, email: u.email, role: u.role, isErased: u.isErased });
console.log("Hash atual:", u.hashedPassword?.slice(0, 30) + "…");
console.log("Comprimento hash:", u.hashedPassword?.length, "chars");
console.log("Prefixo:", u.hashedPassword?.slice(0, 4), "(esperado $2a$/$2b$)");

const ok = await bcrypt.compare(candidate, u.hashedPassword);
console.log("");
console.log(`bcrypt.compare("${candidate}", hash) = ${ok ? "✓ VÁLIDA" : "✗ INVÁLIDA"}`);
