import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

// GET /api/settings/agent-permissions
// Returns all human users in the org with their AgentPermission (if any).
// Auth: ADMIN or MANAGER only.
export async function GET() {
  return withOrgContext(async (session) => {
    if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }

    try {
      const users = await prisma.user.findMany({
        where: {
          organizationId: session.user.organizationId!,
          type: "HUMAN",
          isErased: false,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          avatarUrl: true,
          agentPermission: true,
          // One-to-one relation — gives the current status directly (no array).
          agentStatus: {
            select: { status: true },
          },
        },
        orderBy: { name: "asc" },
      });

      const result = users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        avatarUrl: u.avatarUrl,
        isOnline: u.agentStatus?.status === "ONLINE",
        permissions: u.agentPermission ?? null,
      }));

      return NextResponse.json(result);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ message: "Erro ao listar agentes." }, { status: 500 });
    }
  });
}
