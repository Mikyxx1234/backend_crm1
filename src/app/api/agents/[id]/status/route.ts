import { NextResponse } from "next/server";

import { recordPresenceTransition } from "@/lib/agent-presence";
import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrNull } from "@/lib/request-context";
import { sseBus } from "@/lib/sse-bus";

type Ctx = { params: Promise<{ id: string }> };

// Bug 27/abr/26: usavamos `auth()` direto. A rota chama `withOrgFromCtx`
// (direto ou via service), avaliado ANTES da Prisma extension popular
// o ctx. Migrado para withOrgContext.
export async function GET(_req: Request, ctx: Ctx) {
  return withOrgContext(async () => {
    const { id } = await ctx.params;
    const agentStatus = await prisma.agentStatus.findUnique({ where: { userId: id } });

    return NextResponse.json(
      agentStatus ?? {
        userId: id,
        status: "OFFLINE",
        availableForVoiceCalls: false,
      }
    );
  });
}

export async function PUT(req: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
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

    try {
      const agentStatus = await prisma.agentStatus.upsert({
        where: { userId: id },
        create: withOrgFromCtx({ userId: id, status, availableForVoiceCalls }),
        update: { status, availableForVoiceCalls },
      });

      const statusChanged = !existing || existing.status !== status;
      if (statusChanged) {
        await recordPresenceTransition({ userId: id, nextStatus: status });
        sseBus.publish("presence_update", { organizationId: getOrgIdOrNull(), userId: id, status });
      }

      return NextResponse.json(agentStatus);
    } catch (err) {
      // Mesma proteção defensiva de `/api/agents/me/ping`: P2025/P2003
      // ocorre quando o AgentStatus existe com `organizationId` desalinhado
      // do contexto atual (cenário multi-tenant, user movido de org). A
      // Prisma extension RLS bloqueia o upsert e devolve "Record not found".
      // O fix real é mover o registro pra org correta (ver
      // `scripts/fix-agent-status-cross-org.mjs`). Aqui apenas evitamos
      // poluir log e quebrar o request — o cliente recebe 200 e tenta de
      // novo no próximo heartbeat.
      const isExpected =
        err instanceof Error &&
        (err.message.includes("Record to update not found") ||
          err.message.includes("Record not found") ||
          (err as { code?: string }).code === "P2025" ||
          (err as { code?: string }).code === "P2003");
      if (!isExpected) {
        console.warn(
          "[/api/agents/[id]/status PUT] falhou:",
          err instanceof Error ? err.message : err,
        );
        throw err;
      }
      return NextResponse.json(
        { ok: false, _migrationPending: true },
        { status: 200 },
      );
    }
  });
}
