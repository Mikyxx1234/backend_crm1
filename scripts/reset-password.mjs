/**
 * Reset de senha de um usuario por email.
 *
 * Uso (PowerShell):
 *   $env:RESET_EMAIL="adm@dnawork.ai"
 *   $env:RESET_PASSWORD="NovaSenhaAqui"
 *   node scripts/reset-password.mjs
 *
 * - Nao loga a senha no console (apenas confirma sucesso).
 * - Usa bcryptjs (mesmo algoritmo do login).
 * - Atualiza so o usuario com o email exato.
 */
import { hash } from "bcryptjs";
import pg from "pg";

const email = process.env.RESET_EMAIL?.trim().toLowerCase();
const password = process.env.RESET_PASSWORD;

if (!email || !password) {
  console.error("Defina RESET_EMAIL e RESET_PASSWORD no ambiente.");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Senha precisa ter pelo menos 8 caracteres.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL nao definido.");
  process.exit(1);
}

const hashed = await hash(password, 10);
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const check = await client.query(
    `SELECT id, name, "isErased" FROM users WHERE LOWER(email) = $1 LIMIT 1`,
    [email],
  );
  if (check.rowCount === 0) {
    console.error(`Nenhum usuario com email "${email}".`);
    process.exit(2);
  }
  const user = check.rows[0];
  if (user.isErased) {
    console.error(`Usuario ${user.id} esta marcado como erased; abortando.`);
    process.exit(3);
  }
  const result = await client.query(
    `UPDATE users
        SET "hashedPassword" = $1,
            "updatedAt"      = NOW()
      WHERE id = $2
      RETURNING id, email, name`,
    [hashed, user.id],
  );
  const row = result.rows[0];
  console.log(`OK - senha redefinida.`);
  console.log(`  id   : ${row.id}`);
  console.log(`  email: ${row.email}`);
  console.log(`  name : ${row.name}`);
} catch (err) {
  console.error("Falha:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
