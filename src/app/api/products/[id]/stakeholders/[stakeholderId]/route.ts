import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string; stakeholderId: string }> };

const CHANNELS = new Set(["WHATSAPP", "EMAIL"]);

export async function PUT(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(
      authResult.user,
      "product:manage_stakeholders",
    );
    if (denied) return denied;

    const { stakeholderId } = await context.params;
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (typeof body.role === "string" && body.role.trim()) data.role = body.role.trim();
    if (typeof body.notifyOnSend === "boolean") data.notifyOnSend = body.notifyOnSend;
    if (typeof body.notifyForFeedback === "boolean") {
      data.notifyForFeedback = body.notifyForFeedback;
    }
    if (
      typeof body.channelPreference === "string" &&
      CHANNELS.has(body.channelPreference.toUpperCase())
    ) {
      data.channelPreference = body.channelPreference.toUpperCase();
    }

    try {
      const stakeholder = await prisma.productStakeholder.update({
        where: { id: stakeholderId },
        data,
        include: {
          contact: { select: { id: true, name: true, email: true, phone: true } },
        },
      });
      return NextResponse.json({ stakeholder });
    } catch {
      return NextResponse.json({ message: "Stakeholder não encontrado." }, { status: 404 });
    }
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(
      authResult.user,
      "product:manage_stakeholders",
    );
    if (denied) return denied;

    const { stakeholderId } = await context.params;
    try {
      await prisma.productStakeholder.delete({ where: { id: stakeholderId } });
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ message: "Stakeholder não encontrado." }, { status: 404 });
    }
  });
}
