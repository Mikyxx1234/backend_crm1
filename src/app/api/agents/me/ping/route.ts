import { NextResponse } from "next/server";

import { recordPresenceTransition } from "@/lib/agent-presence";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sseBus } from "@/lib/sse-bus";

export const dynamic = "force-dynamic";

/**
 * Heartbeat de presença enviado pelo cliente (hook `usePresenceHeartbeat`) a cada ~90s
 * quando a aba está visível. Atualiza `lastActivityAt` no AgentStatus e, se o agente
 * estava AWAY, promove-o de volta para ONLINE automaticamente.
 *
 * Para evitar regressões quando a migration ainda não rodou em produção, usamos
 * $executeRaw para tocar em `lastActivityAt` (o Prisma Client pode estar desatualizado
 * em relação ao schema).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const existing = await prisma.agentStatus.findUnique({ where: { userId } });

    let nextStatus: "ONLINE" | "OFFLINE" | "AWAY";
    if (!existing) {
      // Primeira entrada: o ping só vem quando a aba está focada,
      // logo podemos considerar o agente ativo.
      await prisma.agentStatus.create({
        data: { userId, status: "ONLINE", availableForVoiceCalls: false },
      });
      nextStatus = "ONLINE";
    } else if (existing.status === "AWAY") {
      // AWAY → ONLINE automaticamente (agente voltou a interagir).
      await prisma.agentStatus.update({ where: { userId }, data: { status: "ONLINE" } });
      nextStatus = "ONLINE";
    } else {
      // OFFLINE permanece OFFLINE (toggle manual obrigatório para voltar).
      // ONLINE permanece ONLINE.
      nextStatus = existing.status;
    }

    // lastActivityAt via raw SQL para não depender da regeneração do Prisma Client.
    await prisma.$executeRaw`
      UPDATE "agent_statuses"
      SET "lastActivityAt" = NOW()
      WHERE "userId" = ${userId}
    `;

    const statusChanged = !existing || existing.status !== nextStatus;
    if (statusChanged) {
      await recordPresenceTransition({ userId, nextStatus });
      sseBus.publish("presence_update", { userId, status: nextStatus });
    } else if (!existing) {
      // Primeira entrada: abrir primeiro bloco ONLINE no histórico.
      await recordPresenceTransition({ userId, nextStatus });
    }

    return NextResponse.json({ ok: true, status: nextStatus });
  } catch (err) {
    console.warn(
      "[/api/agents/me/ping] falhou (provável migration pendente):",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ ok: false, _migrationPending: true }, { status: 200 });
  }
}
