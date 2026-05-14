// Reseta a senha de um user no banco apontado por DATABASE_URL.
// Uso:
//   DATABASE_URL="..." node scripts/reset-password.mjs <email> <novaSenha>
//
// Gera hash bcrypt com cost 10 (mesmo padrão usado pelo auth.ts em produção).
import { Client } from "pg";
import bcrypt from "bcryptjs";

const [, , email, newPassword] = process.argv;
if (!email || !newPassword) {
  console.error("Uso: node scripts/reset-password.mjs <email> <novaSenha>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não setado.");
  process.exit(1);
}

const hash = await bcrypt.hash(newPassword, 10);

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const before = await c.query(
  `SELECT id, email, name, role, "isErased" FROM users WHERE email = $1`,
  [email],
);
if (before.rowCount === 0) {
  console.error(`User '${email}' não encontrado.`);
  await c.end();
  process.exit(2);
}
console.log("User encontrado:", before.rows[0]);

const r = await c.query(
  `UPDATE users SET "hashedPassword" = $1, "updatedAt" = NOW() WHERE email = $2 RETURNING id, email`,
  [hash, email],
);
console.log("Senha atualizada para:", r.rows[0]);
console.log("");
console.log("Tente agora o login com:");
console.log("  email:", email);
console.log("  senha:", newPassword);

await c.end();
