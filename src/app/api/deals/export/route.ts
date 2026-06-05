import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { csvDate, toCsv } from "@/lib/csv-stringify";
import { prisma } from "@/lib/prisma";
import { getVisibilityFilter } from "@/lib/visibility";

const MAX_ROWS = 100_000;

/**
 * GET /api/deals/export?pipelineId=<id>
 *
 * Exporta negócios em CSV. Sem `pipelineId` (ou `pipelineId=all`) exporta
 * todos os pipelines da org. Cada linha = um negócio, com colunas de
 * negócio + contato + pipeline/estágio + tags + campos personalizados
 * (`cf_*` do negócio e `contact_cf_*` do contato).
 *
 * Os nomes de coluna seguem o formato aceito pelo importador
 * (`/api/deals/import`) onde aplicável, permitindo round-trip.
 *
 * Apenas ADMIN/MANAGER (mesma regra do import). Respeita a visibilidade
 * por usuário (dealWhere) — embora gestores normalmente vejam tudo.
 */
export async function GET(request: Request) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    return await runWithApiUserContext(authResult.user, async () => {
      const role = (authResult.user as { role?: string }).role;
      if (role !== "ADMIN" && role !== "MANAGER") {
        return NextResponse.json(
          { message: "Apenas administradores e gerentes podem exportar dados." },
          { status: 403 },
        );
      }
      const denied = await requirePermissionForUser(authResult.user, "deal:view");
      if (denied) return denied;

      const { searchParams } = new URL(request.url);
      const pipelineParam = searchParams.get("pipelineId");
      const pipelineId =
        pipelineParam && pipelineParam !== "all" ? pipelineParam : undefined;

      const visibility = await getVisibilityFilter(
        authResult.user as { id: string; role: "ADMIN" | "MANAGER" | "MEMBER" },
      );

      // Definições de campos personalizados → colunas estáveis.
      const fieldDefs = await prisma.customField.findMany({
        where: { entity: { in: ["deal", "contact"] } },
        select: { id: true, name: true, entity: true },
        orderBy: { name: "asc" },
      });
      const dealFields = fieldDefs.filter((f) => f.entity === "deal");
      const contactFields = fieldDefs.filter((f) => f.entity === "contact");

      const deals = await prisma.deal.findMany({
        where: {
          ...visibility.dealWhere,
          ...(pipelineId ? { stage: { pipelineId } } : {}),
        },
        take: MAX_ROWS,
        orderBy: [{ createdAt: "asc" }],
        include: {
          stage: { include: { pipeline: { select: { id: true, name: true } } } },
          owner: { select: { id: true, name: true, email: true } },
          tags: { include: { tag: { select: { name: true } } } },
          customFields: { select: { customFieldId: true, value: true } },
          contact: {
            include: {
              company: { select: { name: true } },
              customFields: { select: { customFieldId: true, value: true } },
            },
          },
        },
      });

      const baseHeaders = [
        "deal_number",
        "external_id",
        "title",
        "value",
        "status",
        "pipeline_name",
        "stage_name",
        "owner_name",
        "owner_email",
        "contact_external_id",
        "contact_name",
        "contact_email",
        "contact_phone",
        "contact_company",
        "contact_lifecycle_stage",
        "contact_source",
        "tags",
        "expected_close",
        "lost_reason",
        "position",
        "created_at",
        "updated_at",
        "closed_at",
      ];
      const dealCfHeaders = dealFields.map((f) => `cf_${f.name}`);
      const contactCfHeaders = contactFields.map((f) => `contact_cf_${f.name}`);
      const headers = [...baseHeaders, ...dealCfHeaders, ...contactCfHeaders];

      const rows = deals.map((deal) => {
        const dealCfMap = new Map(
          deal.customFields.map((v) => [v.customFieldId, v.value]),
        );
        const contactCfMap = new Map(
          (deal.contact?.customFields ?? []).map((v) => [v.customFieldId, v.value]),
        );

        const row: Record<string, unknown> = {
          deal_number: deal.number,
          external_id: deal.externalId ?? "",
          title: deal.title,
          value: deal.value != null ? deal.value.toString() : "",
          status: deal.status,
          pipeline_name: deal.stage.pipeline.name,
          stage_name: deal.stage.name,
          owner_name: deal.owner?.name ?? "",
          owner_email: deal.owner?.email ?? "",
          contact_external_id: deal.contact?.externalId ?? "",
          contact_name: deal.contact?.name ?? "",
          contact_email: deal.contact?.email ?? "",
          contact_phone: deal.contact?.phone ?? "",
          contact_company: deal.contact?.company?.name ?? "",
          contact_lifecycle_stage: deal.contact?.lifecycleStage ?? "",
          contact_source: deal.contact?.source ?? "",
          tags: deal.tags.map((t) => t.tag.name).join("; "),
          expected_close: csvDate(deal.expectedClose),
          lost_reason: deal.lostReason ?? "",
          position: deal.position,
          created_at: csvDate(deal.createdAt),
          updated_at: csvDate(deal.updatedAt),
          closed_at: csvDate(deal.closedAt),
        };
        for (const f of dealFields) {
          row[`cf_${f.name}`] = dealCfMap.get(f.id) ?? "";
        }
        for (const f of contactFields) {
          row[`contact_cf_${f.name}`] = contactCfMap.get(f.id) ?? "";
        }
        return row;
      });

      const csv = toCsv(headers, rows);
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `negocios-${stamp}.csv`;

      // BOM UTF-8 para o Excel reconhecer acentuação.
      return new NextResponse("\ufeff" + csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao exportar negócios." }, { status: 500 });
  }
}
