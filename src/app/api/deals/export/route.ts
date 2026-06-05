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

      // Headers em PT-BR natural. Custom fields exportados com o NOME do
      // campo (sem prefixo cf_) — o auto-mapping do import casa por nome.
      // Para evitar colisão com campos do sistema (ex.: campo customizado
      // chamado "Origem" colidindo com `source`), os custom fields ficam
      // ao final da lista de colunas.
      const baseHeaders = [
        "Número do negócio",
        "Título",
        "Valor",
        "Status",
        "Pipeline",
        "Etapa",
        "Responsável",
        "E-mail do responsável",
        "Nome do contato",
        "E-mail do contato",
        "Telefone do contato",
        "Empresa do contato",
        "Ciclo de vida do contato",
        "Origem do contato",
        "Tags",
        "Previsão de fechamento",
        "Motivo da perda",
        "Posição",
        "Criado em",
        "Atualizado em",
        "Fechado em",
      ];
      const dealCfHeaders = dealFields.map((f) => f.name);
      const contactCfHeaders = contactFields.map((f) => `Contato — ${f.name}`);
      const headers = [...baseHeaders, ...dealCfHeaders, ...contactCfHeaders];

      const rows = deals.map((deal) => {
        const dealCfMap = new Map(
          deal.customFields.map((v) => [v.customFieldId, v.value]),
        );
        const contactCfMap = new Map(
          (deal.contact?.customFields ?? []).map((v) => [v.customFieldId, v.value]),
        );

        const row: Record<string, unknown> = {
          "Número do negócio": deal.number,
          "Título": deal.title,
          "Valor": deal.value != null ? deal.value.toString() : "",
          "Status": deal.status,
          "Pipeline": deal.stage.pipeline.name,
          "Etapa": deal.stage.name,
          "Responsável": deal.owner?.name ?? "",
          "E-mail do responsável": deal.owner?.email ?? "",
          "Nome do contato": deal.contact?.name ?? "",
          "E-mail do contato": deal.contact?.email ?? "",
          "Telefone do contato": deal.contact?.phone ?? "",
          "Empresa do contato": deal.contact?.company?.name ?? "",
          "Ciclo de vida do contato": deal.contact?.lifecycleStage ?? "",
          "Origem do contato": deal.contact?.source ?? "",
          "Tags": deal.tags.map((t) => t.tag.name).join("; "),
          "Previsão de fechamento": csvDate(deal.expectedClose),
          "Motivo da perda": deal.lostReason ?? "",
          "Posição": deal.position,
          "Criado em": csvDate(deal.createdAt),
          "Atualizado em": csvDate(deal.updatedAt),
          "Fechado em": csvDate(deal.closedAt),
        };
        for (const f of dealFields) {
          row[f.name] = dealCfMap.get(f.id) ?? "";
        }
        for (const f of contactFields) {
          row[`Contato — ${f.name}`] = contactCfMap.get(f.id) ?? "";
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
