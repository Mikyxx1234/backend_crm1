/**
 * POST /api/catalogs/[id]/save-as-template
 *
 * Clona um catálogo (com suas capacidades) como TEMPLATE reutilizável da org
 * (PRD §6 — "salvar como template"). O template não recebe produtos; serve de
 * ponto de partida pré-respondido para novos catálogos.
 */
import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(
      authResult.user,
      "catalog:save_as_template",
    );
    if (denied) return denied;

    const { id } = await context.params;
    const source = await prisma.catalog.findUnique({
      where: { id },
      include: {
        capabilities: { select: { capabilityKey: true, config: true, enabled: true } },
      },
    });
    if (!source) {
      return NextResponse.json({ message: "Catálogo não encontrado." }, { status: 404 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // body opcional
    }
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : `${source.name} (template)`;

    const template = await prisma.catalog.create({
      data: withOrgFromCtx({
        name,
        description: source.description,
        isTemplate: true,
        isDefault: false,
        templateKey: source.templateKey,
        capabilities: {
          create: source.capabilities.map((c) =>
            withOrgFromCtx({
              capabilityKey: c.capabilityKey,
              config: c.config as object,
              enabled: c.enabled,
            }),
          ),
        },
      }),
      include: {
        capabilities: {
          select: { id: true, capabilityKey: true, config: true, enabled: true },
        },
      },
    });

    return NextResponse.json({ template }, { status: 201 });
  });
}
