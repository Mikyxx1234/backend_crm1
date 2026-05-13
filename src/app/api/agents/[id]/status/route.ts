import { NextResponse } from "next/server";

import { recordPresenceTransition } from "@/lib/agent-presence";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sseBus } from "@/lib/sse-bus";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

  const { id } = await ctx.params;
  const agentStatus = await prisma.agentStatus.findUnique({ where: { userId: id } });

  return NextResponse.json(
    agentStatus ?? {
      userId: id,
      status: "OFFLINE",
      availableForVoiceCalls: false,
    }
  );
}

export async function PUT(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ message: "Não autorizado." }, { status: 401 });

  const { id } = await ctx.params;
  const role = (session.user as { role?: string }).role;
  const canEditOthers = role === "ADMIN" || role === "MANAGER";
  if (id !== session.user.id && !canEditOthers) {
    return NextResponse.json({ message: "Sem permissão." }, { status: 403 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const existing = await prisma.agentStatus.findUnique({ where: { userId: id } });

  const statusRaw = body.status as string | undefined;
  const status =
    statusRaw && ["ONLINE", "OFFLINE", "AWAY"].includes(statusRaw)
      ? (statusRaw as "ONLINE" | "OFFLINE" | "AWAY")
      : existing?.status ?? "OFFLINE";

  if (statusRaw && !["ONLINE", "OFFLINE", "AWAY"].includes(statusRaw)) {
    return NextResponse.json({ message: "Status inválido. Use ONLINE, OFFLINE ou AWAY." }, { status: 400 });
  }

  const availableForVoiceCalls =
    typeof body.availableForVoiceCalls === "boolean"
      ? body.availableForVoiceCalls
      : (existing?.availableForVoiceCalls ?? false);

  const agentStatus = await prisma.agentStatus.upsert({
    where: { userId: id },
    create: { userId: id, status, availableForVoiceCalls },
    update: { status, availableForVoiceCalls },
  });

  const statusChanged = !existing || existing.status !== status;
  if (statusChanged) {
    await recordPresenceTransition({ userId: id, nextStatus: status });
    sseBus.publish("presence_update", { userId: id, status });
  }

  return NextResponse.json(agentStatus);
}
