import { NextResponse } from "next/server";

import { userOrgFilter, withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

/**
 * Metadados para alimentar o painel de filtros do Kanban em uma única chamada.
 * Retorna pipelines+stages, usuários ativos, tags, custom fields (deal e
 * contact) e os `source` distintos dos contatos da org.
 */
export async function GET() {
  return withOrgContext(async (session) => {
    try {
      const [pipelines, users, tags, customFields, sources, lossReasonCatalog, usedLostReasons] = await Promise.all([
        prisma.pipeline.findMany({
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            stages: {
              orderBy: { position: "asc" },
              select: { id: true, name: true, color: true, position: true },
            },
          },
        }),
        // Bug 23/mai/26: o `where` so tinha `isErased: false`, sem filtro
        // de organizationId. Como User NAO esta em SCOPED_MODELS da Prisma
        // Extension (precisa funcionar sem ctx pra login/jwt), a filtragem
        // por org aqui eh MANUAL e OBRIGATORIA — sem ela, o painel de
        // filtros do Kanban listava users de TODAS as orgs do cluster
        // (vazamento cross-tenant grave). Fix: alinhar com /api/users
        // (type: HUMAN + userOrgFilter). isErased mantido pra ocultar
        // contas anonimizadas (LGPD/erasure).
        prisma.user.findMany({
          where: {
            isErased: false,
            type: "HUMAN",
            ...userOrgFilter(session),
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true, avatarUrl: true, role: true, type: true },
        }),
        prisma.tag.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, color: true },
        }),
        prisma.customField.findMany({
          where: { entity: { in: ["deal", "contact"] } },
          orderBy: { label: "asc" },
          select: { id: true, name: true, label: true, type: true, options: true, entity: true },
        }),
        prisma.contact.findMany({
          where: { AND: [{ source: { not: null } }, { source: { not: "" } }] },
          distinct: ["source"],
          select: { source: true },
          orderBy: { source: "asc" },
          take: 200,
        }),
        // Motivos de perda: catálogo configurado + motivos livres ("Outro…")
        // já usados em deals — união alimenta o filtro por motivo.
        prisma.lossReason.findMany({
          where: { isActive: true },
          orderBy: { position: "asc" },
          select: { label: true },
        }),
        prisma.deal.findMany({
          where: { lostReason: { not: null } },
          distinct: ["lostReason"],
          select: { lostReason: true },
          take: 200,
        }),
      ]);

      const dealCustomFields = customFields.filter((cf) => cf.entity === "deal");
      const contactCustomFields = customFields.filter((cf) => cf.entity === "contact");

      const lossReasons = Array.from(
        new Set([
          ...lossReasonCatalog.map((r) => r.label),
          ...usedLostReasons
            .map((d) => d.lostReason)
            .filter((r): r is string => !!r?.trim()),
        ]),
      );

      return NextResponse.json({
        pipelines,
        users,
        tags,
        dealCustomFields,
        contactCustomFields,
        sources: sources
          .map((s) => s.source?.trim())
          .filter((s): s is string => !!s)
          .sort((a, b) => a.localeCompare(b, "pt-BR")),
        lossReasons,
      });
    } catch (e) {
      console.error(e);
      return NextResponse.json(
        { message: "Erro ao carregar opções de filtro." },
        { status: 500 },
      );
    }
  });
}
