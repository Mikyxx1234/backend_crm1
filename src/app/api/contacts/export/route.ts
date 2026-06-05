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
          assignedTo: { select: { id: true, name: true, email: true } },
          tags: { include: { tag: { select: { name: true } } } },
          customFields: { select: { customFieldId: true, value: true } },
        },
      });

      // Headers em PT-BR natural. Custom fields exportados com o nome real
      // do campo (sem prefixo) — auto-mapping casa por nome.
      const baseHeaders = [
        "Nome",
        "E-mail",
        "Telefone",
        "Ciclo de vida",
        "Origem",
        "Empresa",
        "Responsável",
        "E-mail do responsável",
        "Tags",
        "ID da fonte do anúncio",
        "CTWA CLID",
        "Campanha do anúncio",
        "Criado em",
        "Atualizado em",
      ];
      const cfHeaders = contactFields.map((f) => f.name);
      const headers = [...baseHeaders, ...cfHeaders];

      const rows = contacts.map((c) => {
        const cfMap = new Map(c.customFields.map((v) => [v.customFieldId, v.value]));
        const row: Record<string, unknown> = {
          "Nome": c.name,
          "E-mail": c.email ?? "",
          "Telefone": c.phone ?? "",
          "Ciclo de vida": c.lifecycleStage,
          "Origem": c.source ?? "",
          "Empresa": c.company?.name ?? "",
          "Responsável": c.assignedTo?.name ?? "",
          "E-mail do responsável": c.assignedTo?.email ?? "",
          "Tags": c.tags.map((t) => t.tag.name).join("; "),
          "ID da fonte do anúncio": c.adSourceId ?? "",
          "CTWA CLID": c.adCtwaClid ?? "",
          "Campanha do anúncio": c.adResolvedCampaignName ?? "",
          "Criado em": csvDate(c.createdAt),
          "Atualizado em": csvDate(c.updatedAt),
        };
        for (const f of contactFields) {
          row[f.name] = cfMap.get(f.id) ?? "";
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
