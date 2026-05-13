import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

async function main() {
  // Senha do admin: usa SEED_ADMIN_PASSWORD se setado (CI / dev consciente),
  // senão gera aleatória e imprime no console UMA vez. Antes era hardcoded
  // como "admin123" — risco enorme em qualquer ambiente que rodasse o seed
  // com banco exposto.
  const adminPassword =
    process.env.SEED_ADMIN_PASSWORD?.trim() || randomBytes(12).toString("base64url");
  const hashedPassword = await hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@eduit.com" },
    update: {},
    create: {
      name: "Admin EduIT",
      email: "admin@eduit.com",
      hashedPassword,
      role: "ADMIN",
    },
  });

  console.log("Usuário admin criado:", admin.email);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(
      `\n  ⚠ Senha gerada aleatoriamente (defina SEED_ADMIN_PASSWORD pra controlar):\n  → ${adminPassword}\n`,
    );
  }

  const defaultPipeline = await prisma.pipeline.upsert({
    where: { id: "default-pipeline" },
    update: {},
    create: {
      id: "default-pipeline",
      name: "Pipeline Principal",
      isDefault: true,
      stages: {
        create: [
          { name: "Qualificação", position: 0, color: "#6366f1", winProbability: 10, rottingDays: 7 },
          { name: "Contato Feito", position: 1, color: "#8b5cf6", winProbability: 25, rottingDays: 14 },
          { name: "Proposta Enviada", position: 2, color: "#a855f7", winProbability: 50, rottingDays: 14 },
          { name: "Negociação", position: 3, color: "#f59e0b", winProbability: 75, rottingDays: 21 },
          { name: "Fechamento", position: 4, color: "#22c55e", winProbability: 90, rottingDays: 7 },
        ],
      },
    },
  });

  console.log("Pipeline criado:", defaultPipeline.name);

  const tags = ["Quente", "Frio", "VIP", "Parceiro", "Indicação"];
  const tagColors = ["#ef4444", "#3b82f6", "#f59e0b", "#22c55e", "#8b5cf6"];

  for (let i = 0; i < tags.length; i++) {
    await prisma.tag.upsert({
      where: { name: tags[i] },
      update: {},
      create: { name: tags[i], color: tagColors[i] },
    });
  }

  console.log("Tags criadas:", tags.join(", "));
  console.log("Seed concluído com sucesso!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
