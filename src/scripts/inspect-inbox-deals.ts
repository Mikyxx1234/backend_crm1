/**
 * Inspeção rápida — verifica se os contatos do Inbox têm deal OPEN
 * e em qual stage/pipeline estão. Usado para diagnosticar o caso
 * "leads aparecem no inbox mas não em Lead de Entrada".
 *
 * Uso:
 *   cd backend
 *   pnpm tsx src/scripts/inspect-inbox-deals.ts "Anderson Dias" "Mi" "Marcelo Pinheiro"
 *
 * Sem args: pega os 10 contatos com conversa aberta mais recente.
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const names = process.argv.slice(2);

  const contacts = names.length
    ? await prisma.contact.findMany({
        where: { name: { in: names } },
        select: { id: true, name: true, phone: true, organizationId: true },
      })
    : await prisma.contact.findMany({
        where: { conversations: { some: { status: "OPEN" } } },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: { id: true, name: true, phone: true, organizationId: true },
      });

  if (contacts.length === 0) {
    console.log("Nenhum contato encontrado.");
    return;
  }

  for (const c of contacts) {
    const deals = await prisma.deal.findMany({
      where: { contactId: c.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        number: true,
        status: true,
        createdAt: true,
        stage: {
          select: {
            name: true,
            isIncoming: true,
            pipeline: { select: { name: true } },
          },
        },
      },
    });

    console.log("\n────────────────────────────────────────────");
    console.log(`Contato: ${c.name} (${c.phone ?? "sem telefone"})`);
    console.log(`  orgId:    ${c.organizationId}`);
    console.log(`  contactId:${c.id}`);

    if (deals.length === 0) {
      console.log("  ⚠ NENHUM deal vinculado — auto-deals não rodou.");
      continue;
    }

    for (const d of deals) {
      const flag = d.stage?.isIncoming ? " [INCOMING]" : "";
      console.log(
        `  • #${d.number} [${d.status}] ${d.stage?.pipeline?.name} / ${d.stage?.name}${flag} — ${d.createdAt.toISOString()}`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
