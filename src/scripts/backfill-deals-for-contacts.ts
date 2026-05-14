/**
 * backfill-deals-for-contacts
 *
 * Varredura pontual — para cada contato com conversa mas SEM deal aberto,
 * cria um deal no estágio de entrada do primeiro pipeline. Resolve o
 * histórico acumulado do bug onde `autoCreateDeal` só rodava em contatos
 * novos: contatos importados ou criados antes dessa feature ficaram
 * órfãos (no Inbox → "Painel CRM → Nenhum negócio aberto"; no Kanban
 * deals antigos de volume baixo).
 *
 * Uso:
 *   pnpm tsx src/scripts/backfill-deals-for-contacts.ts          # dry-run
 *   pnpm tsx src/scripts/backfill-deals-for-contacts.ts --apply  # aplica
 *
 * Idempotente: roda `ensureOpenDealForContact` por contato; se já tem
 * deal OPEN não faz nada. Seguro de re-executar.
 */

import { prisma } from "@/lib/prisma";
import { ensureOpenDealForContact } from "@/services/auto-deals";

async function main() {
  const apply = process.argv.includes("--apply");

  // Critério: contato que tem pelo menos UMA conversa registrada (i.e.
  // interação real) e NENHUM deal com status OPEN. Ignoramos contatos
  // sem conversas porque muitas vezes são cadastros manuais de
  // "prospect" que o usuário explicitamente não quer virar deal.
  const candidates = await prisma.contact.findMany({
    where: {
      conversations: { some: {} },
      deals: { none: { status: "OPEN" } },
    },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `[backfill] ${candidates.length} contato(s) com conversa e sem deal OPEN${
      apply ? "" : " (dry-run — use --apply para criar)"
    }`,
  );

  if (!apply) {
    for (const c of candidates.slice(0, 20)) {
      console.log(`  - ${c.name} (${c.id})`);
    }
    if (candidates.length > 20) {
      console.log(`  … +${candidates.length - 20} restantes`);
    }
    return;
  }

  let created = 0;
  let existing = 0;
  let skipped = 0;

  for (const c of candidates) {
    try {
      const result = await ensureOpenDealForContact({
        contactId: c.id,
        contactName: c.name,
        source: "backfill",
        logTag: "backfill",
      });
      if (result.status === "created") created++;
      else if (result.status === "existing") existing++;
      else skipped++;
    } catch (err) {
      console.error(`[backfill] erro no contato ${c.id}:`, (err as Error).message);
    }
  }

  console.log(
    `[backfill] concluído — criados: ${created}, já existentes: ${existing}, pulados: ${skipped}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
