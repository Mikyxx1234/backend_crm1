/**
 * Recuperação de acesso admin de um usuário (lock-out de permissões).
 *
 * Restaura, de forma idempotente, um usuário a administrador da org:
 *   1. users.role = 'ADMIN'
 *   2. garante o preset Role ADMIN da org com permissions = ['*']
 *      (recria se sumiu; restaura o '*' se a lista foi esvaziada)
 *   3. garante o user_role_assignment user → role ADMIN
 *
 * Uso:
 *   DATABASE_URL=postgresql://... node scripts/dev/grant-admin.mjs <email>
 *
 * Opcional:
 *   GRANT_SUPERADMIN=true  → também marca isSuperAdmin (equipe EduIT). Por
 *                            padrão NÃO escala para super-admin.
 *
 * É seguro rodar mais de uma vez. Não apaga nada além de reescrever a lista
 * de permissions do preset ADMIN para ['*'].
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const [, , email] = process.argv;
if (!email) {
  console.error("Uso: DATABASE_URL=... node scripts/dev/grant-admin.mjs <email>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL não setado.");
  process.exit(1);
}

const grantSuperAdmin = process.env.GRANT_SUPERADMIN === "true";

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

try {
  // 1. Localiza o usuário
  const userRes = await c.query(
    `SELECT id, email, name, role, "isSuperAdmin", "organizationId"
       FROM users WHERE email = $1`,
    [email],
  );
  const user = userRes.rows[0];
  if (!user) {
    console.error(`❌ Usuário não encontrado: ${email}`);
    process.exit(2);
  }

  console.log("=== Antes ===");
  console.log({
    id: user.id,
    email: user.email,
    role: user.role,
    isSuperAdmin: user.isSuperAdmin,
    organizationId: user.organizationId,
  });

  if (!user.organizationId) {
    console.error(
      "❌ Usuário sem organizationId. Se for super-admin EduIT, rode com GRANT_SUPERADMIN=true; caso contrário, há inconsistência de dados.",
    );
  }

  // 2. Atualiza o enum legacy User.role (e isSuperAdmin se pedido)
  await c.query(
    `UPDATE users
        SET role = 'ADMIN'${grantSuperAdmin ? ', "isSuperAdmin" = true' : ""}
      WHERE id = $1`,
    [user.id],
  );
  console.log(`✅ users.role = 'ADMIN'${grantSuperAdmin ? " + isSuperAdmin = true" : ""}`);

  // 3. Garante o preset Role ADMIN da org com permissions = ['*']
  let roleId = null;
  if (user.organizationId) {
    const roleRes = await c.query(
      `SELECT id, name, permissions FROM roles
        WHERE "organizationId" = $1 AND "systemPreset" = 'ADMIN'
        LIMIT 1`,
      [user.organizationId],
    );

    if (roleRes.rowCount > 0) {
      roleId = roleRes.rows[0].id;
      const perms = roleRes.rows[0].permissions ?? [];
      console.log(
        `• Preset ADMIN encontrado (${roleId}) — permissions atuais:`,
        JSON.stringify(perms),
      );
      if (!perms.includes("*")) {
        await c.query(
          `UPDATE roles SET permissions = ARRAY['*'], "updatedAt" = NOW() WHERE id = $1`,
          [roleId],
        );
        console.log("✅ permissions do preset ADMIN restauradas para ['*']");
      } else {
        console.log("• preset ADMIN já possui '*' — nada a alterar");
      }
    } else {
      roleId = `cre${randomUUID().replace(/-/g, "").slice(0, 22)}`;
      await c.query(
        `INSERT INTO roles
           (id, "organizationId", name, description, "systemPreset", "isSystem", permissions, "createdAt", "updatedAt")
         VALUES ($1, $2, 'Administrador', 'Acesso total à organização', 'ADMIN', true, ARRAY['*'], NOW(), NOW())`,
        [roleId, user.organizationId],
      );
      console.log(`✅ Preset ADMIN recriado (${roleId}) com permissions ['*']`);
    }

    // 4. Garante a atribuição user → role ADMIN
    const uraId = `ura${randomUUID().replace(/-/g, "").slice(0, 22)}`;
    await c.query(
      `INSERT INTO user_role_assignments
         (id, "userId", "roleId", "organizationId", "assignedById", "createdAt")
       VALUES ($1, $2, $3, $4, NULL, NOW())
       ON CONFLICT ("userId", "roleId") DO NOTHING`,
      [uraId, user.id, roleId, user.organizationId],
    );
    console.log("✅ user_role_assignment garantido (user → preset ADMIN)");
  }

  // 5. Estado final
  const after = (
    await c.query(
      `SELECT u.role, u."isSuperAdmin",
              (SELECT COUNT(*) FROM user_role_assignments ura WHERE ura."userId" = u.id) AS assignments
         FROM users u WHERE u.id = $1`,
      [user.id],
    )
  ).rows[0];
  console.log("\n=== Depois ===");
  console.log({
    email: user.email,
    role: after.role,
    isSuperAdmin: after.isSuperAdmin,
    assignments: Number(after.assignments),
  });
  console.log("\n✔ Acesso admin restaurado. Faça logout/login no CRM para renovar a sessão.");
} catch (e) {
  console.error("❌ Erro:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
