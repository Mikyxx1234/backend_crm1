/**
 * backfill-inbox-deals
 *
 * Cria deal OPEN no estágio `isIncoming` (Lead de Entrada) para todo
 * contato que tem conversa registrada mas nenhum deal OPEN.
 *
 * Uso:
 *   pnpm tsx src/scripts/backfill-inbox-deals.ts            # dry-run
 *   pnpm tsx src/scripts/backfill-inbox-deals.ts --apply    # aplica
 *
 * IMPORTANTE: carrega `.env.local` ANTES de importar módulos que
 * instanciam Prisma — `prismaBase` faz `new PrismaClient()` no
 * top-level, então qualquer `import` estático ali rodaria sem
 * DATABASE_URL e estouraria "SASL: client password must be a string".
 * Por isso usamos dynamic import depois do `loadEnv`.
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

async function main() {
  const apply = process.argv.includes("--apply");

  const { prismaBase } = await import("@/lib/prisma-base");
  const { withSystemContext } = await import("@/lib/webhook-context");
  const { ensureOpenDealForContact } = await import("@/services/auto-deals");

  const candidates = await prismaBase.contact.findMany({
    where: {
      conversations: { some: {} },
      deals: { none: { status: "OPEN" } },
    },
    select: { id: true, name: true, organizationId: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `[backfill-inbox] ${candidates.length} contato(s) com conversa e sem deal OPEN${
      apply ? "" : " (dry-run — use --apply para criar)"
    }`,
  );

  for (const c of candidates) {
    console.log(`  - ${c.name} (${c.id}) [org ${c.organizationId}]`);
  }

  if (!apply) {
    await prismaBase.$disconnect();
    return;
  }

  let created = 0;
  let existing = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of candidates) {
    try {
      const result = await withSystemContext(c.organizationId, () =>
        ensureOpenDealForContact({
          contactId: c.id,
          contactName: c.name,
          source: "backfill_inbox",
          logTag: "backfill-inbox",
        }),
      );
      if (result.status === "created") {
        created++;
        console.log(`  ✓ ${c.name} → deal ${result.dealId}`);
      } else if (result.status === "existing") {
        existing++;
      } else {
        skipped++;
        console.log(`  ⊘ ${c.name} → pulado (sem pipeline)`);
      }
    } catch (err) {
      failed++;
      console.error(
        `  ✗ ${c.name} (${c.id}): ${(err as Error).message}`,
      );
    }
  }

  console.log(
    `\n[backfill-inbox] concluído — criados: ${created}, existentes: ${existing}, pulados: ${skipped}, erros: ${failed}`,
  );

  await prismaBase.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
