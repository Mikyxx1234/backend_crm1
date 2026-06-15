import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

type RouteContext = { params: Promise<{ id: string }> };

const CHANNELS = new Set(["WHATSAPP", "EMAIL"]);

export async function GET(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "product:view");
    if (denied) return denied;

    const { id } = await context.params;
    const stakeholders = await prisma.productStakeholder.findMany({
      where: { productId: id },
      include: {
        contact: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ stakeholders });
  });
}

export async function POST(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(
      authResult.user,
      "product:manage_stakeholders",
    );
    if (denied) return denied;

    const { id } = await context.params;
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const contactId = typeof body.contactId === "string" ? body.contactId : "";
    if (!contactId) {
      return NextResponse.json(
        { message: "contactId é obrigatório (stakeholder é sempre um contato)." },
        { status: 400 },
      );
    }
    const role = typeof body.role === "string" ? body.role.trim() : "";
    if (!role) {
      return NextResponse.json({ message: "role é obrigatório." }, { status: 400 });
    }
    const channelPreference =
      typeof body.channelPreference === "string" &&
      CHANNELS.has(body.channelPreference.toUpperCase())
        ? body.channelPreference.toUpperCase()
        : "WHATSAPP";

    const stakeholder = await prisma.productStakeholder.create({
      data: withOrgFromCtx({
        productId: id,
        contactId,
        role,
        notifyOnSend: body.notifyOnSend === true,
        notifyForFeedback: body.notifyForFeedback === true,
        channelPreference: channelPreference as never,
      }),
      include: {
        contact: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    return NextResponse.json({ stakeholder }, { status: 201 });
  });
}
