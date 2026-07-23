/**
 * purge-pipelines-deals
 *
 * Remove TODOS os funis (pipelines) e cards (deals) de UMA organização.
 * Uso pontual para limpar dados subidos por engano em produção.
 *
 * Ordem de exclusão (respeita as FKs do banco):
 *   1) deals    → cascateia deal_products, tags_on_deals, deal_custom_field_values,
 *                 deal_events, activity_events, deal_quotas, deal_links, etc.
 *                 e faz SET NULL em activities.dealId / notes.dealId / calls.dealId.
 *   2) pipelines → cascateia stages, pipeline_loss_reasons, distribution_rules
 *                 e faz SET NULL em channels.defaultPipelineId / automações.
 *
 * Usa prismaBase (cross-org) porque scripts rodam fora de RequestContext.
 * TODO where é escopado manualmente por organizationId — nunca toca outra org.
 *
 * Uso:
 *   pnpm tsx src/scripts/purge-pipelines-deals.ts --org <orgId>            # dry-run
 *   pnpm tsx src/scripts/purge-pipelines-deals.ts --org <orgId> --apply    # aplica
 *
 * Carrega `.env.local`/`.env` ANTES de importar prismaBase (que instancia
 * PrismaClient no top-level lendo DATABASE_URL) — por isso o import é
 * dinâmico dentro de main(). Pode-se também passar DATABASE_URL inline no
 * comando para apontar direto pra produção.
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv({ path: resolve(process.cwd(), ".env") });

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgId = getArg("--org");
  const apply = process.argv.includes("--apply");

  if (!orgId) {
    console.error("Erro: informe --org <organizationId>.");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error(
      "Erro: DATABASE_URL não definida. Crie .env.local com a URL de produção " +
        "ou rode com a variável inline no comando.",
    );
    process.exit(1);
  }

  const { prismaBase } = await import("@/lib/prisma-base");

  const org = await prismaBase.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) {
    console.error(`Erro: organização "${orgId}" não encontrada.`);
    process.exit(1);
  }

  const [pipelines, stages, deals] = await Promise.all([
    prismaBase.pipeline.count({ where: { organizationId: orgId } }),
    prismaBase.stage.count({ where: { organizationId: orgId } }),
    prismaBase.deal.count({ where: { organizationId: orgId } }),
  ]);

  console.log(`[purge] Org: ${org.name} (${org.id})`);
  console.log(`[purge] Alvo → pipelines: ${pipelines} | stages: ${stages} | deals: ${deals}`);

  if (pipelines === 0 && deals === 0) {
    console.log("[purge] Nada a remover. Encerrando.");
    return;
  }

  if (!apply) {
    console.log("[purge] DRY-RUN — nada foi apagado. Use --apply para executar.");
    return;
  }

  try {
    const result = await prismaBase.$transaction(async (tx) => {
      const delDeals = await tx.deal.deleteMany({ where: { organizationId: orgId } });
      const delPipelines = await tx.pipeline.deleteMany({ where: { organizationId: orgId } });
      return { deals: delDeals.count, pipelines: delPipelines.count };
    });

    const remainingStages = await prismaBase.stage.count({
      where: { organizationId: orgId },
    });

    console.log(
      `[purge] OK — removidos ${result.deals} deals e ${result.pipelines} pipelines ` +
        `(stages remanescentes: ${remainingStages}).`,
    );
  } finally {
    await prismaBase.$disconnect();
  }
}

main().catch((e) => {
  console.error("[purge] Falhou:", e);
  process.exit(1);
});
