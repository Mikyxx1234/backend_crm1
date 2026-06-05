/**
 * Garante que o usuário da org "teste-dev" tem o role ADMIN.
 * Uso: node fix-admin-role.mjs [email_do_usuario]
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Carrega .env.local manualmente
try {
  const envFile = readFileSync(resolve(__dirname, ".env.local"), "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.warn("Aviso: .env.local nao encontrado, usando env existente");
}

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const emailArg = process.argv[2];

  // 1. Localiza a org teste-dev
  const org = await prisma.organization.findFirst({
    where: { slug: "teste-dev" },
  });
  if (!org) {
    console.error("Org 'teste-dev' nao encontrada.");
    process.exit(1);
  }
  console.log(`Org: ${org.name} (${org.id})`);

  // 2. Lista todos os users da org
  const users = await prisma.user.findMany({
    where: { organizationId: org.id, type: "HUMAN" },
    select: { id: true, email: true, name: true, role: true },
  });

  console.log("\nUsuarios na org:");
  users.forEach((u) => {
    console.log(`  - ${u.email} (userId=${u.id}, role=${u.role})`);
  });

  // 3. Seleciona o usuário target
  const targetUser = emailArg
    ? users.find((u) => u.email === emailArg)
    : users[0];

  if (!targetUser) {
    console.error(`\nUsuario '${emailArg}' nao encontrado na org.`);
    process.exit(1);
  }

  const userId = targetUser.id;
  console.log(`\nTarget: ${targetUser.email} (${userId})`);

  // 4. Localiza o role ADMIN da org
  let adminRole = await prisma.role.findFirst({
    where: { organizationId: org.id, systemPreset: "ADMIN" },
  });

  if (!adminRole) {
    // Cria o role ADMIN se não existir
    console.log("Role ADMIN nao encontrado — criando...");
    adminRole = await prisma.role.create({
      data: {
        organizationId: org.id,
        name: "Administrador",
        systemPreset: "ADMIN",
        permissions: ["*"],
      },
    });
    console.log(`Role ADMIN criado: ${adminRole.id}`);
  } else {
    console.log(`Role ADMIN encontrado: ${adminRole.id} (permissions: ${adminRole.permissions.join(", ")})`);
  }

  // 5. Verifica se o assignment já existe
  const existing = await prisma.userRoleAssignment.findFirst({
    where: { userId, roleId: adminRole.id, organizationId: org.id },
  });

  if (existing) {
    console.log("\nUsuario JA tem o role ADMIN — nenhuma alteracao necessaria.");
  } else {
    await prisma.userRoleAssignment.create({
      data: { userId, roleId: adminRole.id, organizationId: org.id },
    });
    console.log("\n✅ Role ADMIN atribuido com sucesso!");
  }

  // 6. Mostra todos os assignments do usuário
  const allAssignments = await prisma.userRoleAssignment.findMany({
    where: { userId, organizationId: org.id },
    include: { role: true },
  });

  console.log("\nRoles atuais do usuario:");
  allAssignments.forEach((a) => {
    console.log(`  - ${a.role.name} (preset=${a.role.systemPreset ?? "custom"}, perms=${a.role.permissions.join(", ")})`);
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
