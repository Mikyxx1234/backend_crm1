/**
 * Backfill de TAGS nos NEGÓCIOS a partir das tags do CONTATO vinculado (T6).
 *
 * CONTEXTO: na migração, as tags foram gravadas apenas nos CONTATOS
 * (join `tags_on_contacts`). Os NEGÓCIOS ficaram sem tags. Regra adotada:
 * cada negócio herda as tags do seu contato vinculado (`deals."contactId"`).
 *
 * IDEMPOTÊNCIA: usa `INSERT ... SELECT ... ON CONFLICT ("dealId","tagId")
 * DO NOTHING` na PK do join `tags_on_deals`. Rodar 2x não duplica.
 *
 * ISOLAMENTO: usa o POOL DEDICADO de import (`prisma-import`, IMPORT_DB_POOL_MAX,
 * statement/lock timeouts) e faz PAUSA entre lotes — para não competir com o
 * pool interativo dos outros tenants no Postgres compartilhado. Rode em janela
 * de menor uso.
 *
 * COMO RODAR (defina DATABASE_URL no ambiente):
 *   npx tsx scripts/backfill-deal-tags.ts --org <organizationId>
 *   npx tsx scripts/backfill-deal-tags.ts --org <organizationId> --dry-run
 *   npx tsx scripts/backfill-deal-tags.ts --org <organizationId> --batch 1000 --sleep 100
 *
 * Só afeta a org informada (`--org` obrigatório). Escopo multi-tenant garantido
 * por `deals."organizationId" = $org` no WHERE.
 */

import { prismaImportPool } from "../src/lib/prisma-import";

type Args = {
  org: string | null;
  batch: number;
  sleepMs: number;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { org: null, batch: 1000, sleepMs: 100, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--org") args.org = argv[++i] ?? null;
    else if (a === "--batch") args.batch = Math.max(1, Number(argv[++i]) || 1000);
    else if (a === "--sleep") args.sleepMs = Math.max(0, Number(argv[++i]) || 0);
  }
  return args;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.org) {
    console.error(
      "Uso: backfill-deal-tags.ts --org <organizationId> [--batch 1000] [--sleep 100] [--dry-run]",
    );
    process.exit(1);
  }

  console.log(
    `[backfill-deal-tags] ${args.dryRun ? "(DRY-RUN) " : ""}org=${args.org} batch=${args.batch} sleep=${args.sleepMs}ms`,
  );

  let cursor = "";
  let scannedDeals = 0;
  let totalLinks = 0;
  let batchIndex = 0;

  for (;;) {
    // Pagina os negócios da org (com contato vinculado) por id crescente.
    const page = await prismaImportPool.query<{ id: string }>(
      `SELECT id FROM deals
        WHERE "organizationId" = $1
          AND "contactId" IS NOT NULL
          AND id > $2
        ORDER BY id ASC
        LIMIT $3`,
      [args.org, cursor, args.batch],
    );

    const ids = page.rows.map((r) => r.id);
    if (ids.length === 0) break;

    batchIndex += 1;
    scannedDeals += ids.length;
    cursor = ids[ids.length - 1];

    if (args.dryRun) {
      const pending = await prismaImportPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM deals d
           JOIN tags_on_contacts toc ON toc."contactId" = d."contactId"
           LEFT JOIN tags_on_deals tod
             ON tod."dealId" = d.id AND tod."tagId" = toc."tagId"
          WHERE d."organizationId" = $1
            AND d.id = ANY($2::text[])
            AND tod."dealId" IS NULL`,
        [args.org, ids],
      );
      const n = Number(pending.rows[0]?.count ?? "0");
      totalLinks += n;
      console.log(
        `[backfill-deal-tags] lote ${batchIndex}: ${ids.length} negócios, ${n} vínculos NOVOS (dry-run)`,
      );
    } else {
      const inserted = await prismaImportPool.query(
        `INSERT INTO tags_on_deals ("dealId", "tagId")
         SELECT d.id, toc."tagId"
           FROM deals d
           JOIN tags_on_contacts toc ON toc."contactId" = d."contactId"
          WHERE d."organizationId" = $1
            AND d.id = ANY($2::text[])
         ON CONFLICT ("dealId", "tagId") DO NOTHING`,
        [args.org, ids],
      );
      const n = inserted.rowCount ?? 0;
      totalLinks += n;
      console.log(
        `[backfill-deal-tags] lote ${batchIndex}: ${ids.length} negócios, ${n} vínculos criados`,
      );
    }

    if (args.sleepMs > 0) await sleep(args.sleepMs);
  }

  console.log(
    `[backfill-deal-tags] Concluído. Negócios varridos: ${scannedDeals}. ` +
      `Vínculos ${args.dryRun ? "que seriam criados" : "criados"}: ${totalLinks}.`,
  );
}

main()
  .catch((err) => {
    console.error("[backfill-deal-tags] Falhou:", err);
    process.exit(1);
  })
  .finally(() => {
    void prismaImportPool.end();
  });
