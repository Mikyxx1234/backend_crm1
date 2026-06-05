import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { csvDate, toCsv } from "@/lib/csv-stringify";
import { prisma } from "@/lib/prisma";

const MAX_ROWS = 100_000;

/**
 * GET /api/contacts/export
 *
 * Exporta contatos em CSV (1 linha por contato), com colunas estáveis +
 * campos personalizados (`cf_*`). Nomes de coluna seguem o importador
 * (`/api/contacts/import`) onde aplicável, permitindo round-trip.
 *
 * Apenas ADMIN/MANAGER (mesma regra do import).
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
      const denied = await requirePermissionForUser(authResult.user, "contact:view");
      if (denied) return denied;

      const contactFields = await prisma.customField.findMany({
        where: { entity: "contact" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });

      const contacts = await prisma.contact.findMany({
        take: MAX_ROWS,
        orderBy: [{ createdAt: "asc" }],
        include: {
          company: { select: { name: true } },
          assignedTo: { select: { id: true, email: true } },
          tags: { include: { tag: { select: { name: true } } } },
          customFields: { select: { customFieldId: true, value: true } },
        },
      });

      const baseHeaders = [
        "external_id",
        "name",
        "email",
        "phone",
        "lifecycle_stage",
        "source",
        "company",
        "assigned_to_email",
        "tags",
        "ad_source_id",
        "ad_ctwa_clid",
        "ad_resolved_campaign_name",
        "created_at",
        "updated_at",
      ];
      const cfHeaders = contactFields.map((f) => `cf_${f.name}`);
      const headers = [...baseHeaders, ...cfHeaders];

      const rows = contacts.map((c) => {
        const cfMap = new Map(c.customFields.map((v) => [v.customFieldId, v.value]));
        const row: Record<string, unknown> = {
          external_id: c.externalId ?? "",
          name: c.name,
          email: c.email ?? "",
          phone: c.phone ?? "",
          lifecycle_stage: c.lifecycleStage,
          source: c.source ?? "",
          company: c.company?.name ?? "",
          assigned_to_email: c.assignedTo?.email ?? "",
          tags: c.tags.map((t) => t.tag.name).join("; "),
          ad_source_id: c.adSourceId ?? "",
          ad_ctwa_clid: c.adCtwaClid ?? "",
          ad_resolved_campaign_name: c.adResolvedCampaignName ?? "",
          created_at: csvDate(c.createdAt),
          updated_at: csvDate(c.updatedAt),
        };
        for (const f of contactFields) {
          row[`cf_${f.name}`] = cfMap.get(f.id) ?? "";
        }
        return row;
      });

      const csv = toCsv(headers, rows);
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `contatos-${stamp}.csv`;

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
    return NextResponse.json({ message: "Erro ao exportar contatos." }, { status: 500 });
  }
}
