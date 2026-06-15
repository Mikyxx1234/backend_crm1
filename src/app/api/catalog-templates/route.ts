/**
 * GET /api/catalog-templates
 *
 * Lista os templates de catálogo da org (catálogos com `isTemplate=true`),
 * incluindo as capacidades pré-respondidas. O wizard usa estes templates para
 * pré-marcar respostas (PRD §6 — "templates pré-respondem; nunca bloqueiam").
 *
 * Templates built-in por segmento (loja, SaaS, educação, recrutamento,
 * consultoria, eventos) são seed de dados — aparecem aqui quando semeados.
 */
import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "catalog:view");
    if (denied) return denied;

    const templates = await prisma.catalog.findMany({
      where: { isTemplate: true },
      orderBy: { name: "asc" },
      include: {
        capabilities: {
          select: { id: true, capabilityKey: true, config: true, enabled: true },
        },
      },
    });
    return NextResponse.json({ templates });
  });
}
