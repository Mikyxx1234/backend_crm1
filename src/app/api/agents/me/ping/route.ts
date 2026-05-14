import { NextResponse } from "next/server";
import { recordPresenceTransition } from "@/lib/agent-presence";
import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getOrgIdOrNull } from "@/lib/request-context";
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
 *
 * Bug 27/abr/26: usavamos `auth()` direto, e `withOrgFromCtx({ ... })` no
 * payload de `agentStatus.create` era avaliado ANTES da Prisma extension
 * popular o ctx via fallback de cookie — quebrando heartbeats em primeiro
 * acesso. Migrado para withOrgContext.
 */
export async function POST() {
  return withOrgContext(async (session) => {
    const userId = session.user.id;

    try {
      // Fluxo idempotente e race-safe: evita janela findUnique -> create
      // que gerava P2002 (unique userId) quando pings concorrentes chegavam.
      const awoke = await prisma.agentStatus.updateMany({
        where: { userId, status: "AWAY" },
        data: { status: "ONLINE" },
      });
      const statusRow = await prisma.agentStatus.upsert({
        where: { userId },
        create: withOrgFromCtx({
          userId,
          status: "ONLINE" as const,
          availableForVoiceCalls: false,
        }),
        update: {},
      });
      const nextStatus: "ONLINE" | "OFFLINE" | "AWAY" =
        awoke.count > 0 ? "ONLINE" : statusRow.status;

      // lastActivityAt via raw SQL para não depender da regeneração do Prisma Client.
      // PR-1.1 audit: TENANT-FILTER-OK — userId é @unique e vem da session
      // autenticada (não pode ser falsificado). Sob RLS (PR 1.4), o UPDATE só
      // atingirá a linha visível ao tenant da sessão (SET LOCAL app.organization_id),
      // mantendo isolamento sem precisar de filtro explícito de organizationId.
      await prisma.$executeRaw`
        UPDATE "agent_statuses"
        SET "lastActivityAt" = NOW()
        WHERE "userId" = ${userId}
      `;

      const statusChanged = awoke.count > 0;
      if (statusChanged) {
        await recordPresenceTransition({ userId, nextStatus });
        sseBus.publish("presence_update", { organizationId: getOrgIdOrNull(), userId, status: nextStatus });
      } else if (statusRow.status === "ONLINE") {
        // Primeira entrada: abrir primeiro bloco ONLINE no histórico.
        await recordPresenceTransition({ userId, nextStatus });
      }

      return NextResponse.json({ ok: true, status: nextStatus });
    } catch (err) {
      // Silencia erros esperados de registro não encontrado (AgentStatus
      // ainda não criado para este usuário). Não logar como warn pois
      // spama os logs em produção sem ação necessária.
      const isExpected =
        err instanceof Error &&
        (err.message.includes("Record to update not found") ||
          err.message.includes("Record not found") ||
          (err as { code?: string }).code === "P2025" ||
          (err as { code?: string }).code === "P2003");
      if (!isExpected) {
        console.warn(
          "[/api/agents/me/ping] falhou:",
          err instanceof Error ? err.message : err
        );
      }
      return NextResponse.json({ ok: false, _migrationPending: true }, { status: 200 });
    }
  });
}
