import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

/**
 * Metadados para alimentar o painel de filtros do Kanban em uma única chamada.
 * Retorna pipelines+stages, usuários ativos, tags, custom fields (deal e
 * contact) e os `source` distintos dos contatos da org.
 */
export async function GET() {
  return withOrgContext(async () => {
    try {
      const [pipelines, users, tags, customFields, sources] = await Promise.all([
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
        prisma.user.findMany({
          where: { isErased: false },
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
          where: { source: { not: null } },
          distinct: ["source"],
          select: { source: true },
          take: 200,
        }),
      ]);

      const dealCustomFields = customFields.filter((cf) => cf.entity === "deal");
      const contactCustomFields = customFields.filter((cf) => cf.entity === "contact");

      return NextResponse.json({
        pipelines,
        users,
        tags,
        dealCustomFields,
        contactCustomFields,
        sources: sources.map((s) => s.source).filter((s): s is string => !!s),
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
