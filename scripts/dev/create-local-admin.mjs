import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.LOCAL_ADMIN_EMAIL ?? "admlocal@eduit.com.br";
  const password = process.env.LOCAL_ADMIN_PASSWORD;
  const name = process.env.LOCAL_ADMIN_NAME ?? "Admin Local";

  if (!password) {
    console.error(
      "❌ Defina LOCAL_ADMIN_PASSWORD (ex.: LOCAL_ADMIN_PASSWORD=trocar123 node scripts/dev/create-local-admin.mjs)",
    );
    process.exit(1);
  }

  const hashedPassword = await hash(password, 12);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { hashedPassword, isSuperAdmin: true, role: "ADMIN" },
    });
    console.log(`✅ Usuário atualizado: ${email}`);
    return;
  }

  // Cria ou reutiliza organização local
  let org = await prisma.organization.findFirst({
    where: { name: "EduIT Local" },
  });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: "EduIT Local", slug: "eduit-local" },
    });
    console.log(`✅ Organização criada: ${org.name}`);
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      hashedPassword,
      role: "ADMIN",
      isSuperAdmin: true,
      organizationId: org.id,
    },
  });

  console.log(`✅ Usuário criado: ${user.email} (id: ${user.id})`);
  console.log(`   Role: ${user.role} | isSuperAdmin: ${user.isSuperAdmin}`);
}

main()
  .catch((e) => {
    console.error("❌ Erro:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
