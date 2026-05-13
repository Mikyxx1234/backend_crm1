import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Capacidade do agente para o PresenceDashboard no Inbox.
 *
 * Conceito — quão ocupado o agente está AGORA, expresso em % da carga
 * máxima recomendada. Usamos:
 *
 *   activeConversations = conversas OPEN atribuídas a ele
 *                         (ignoramos PENDING/SNOOZED/RESOLVED)
 *   maxConcurrent       = limite recomendado (20 por padrão — pode
 *                         virar `User.maxConcurrentConversations` no
 *                         futuro sem quebrar consumidor).
 *
 *   loadPct = clamp(active / max × 100, 0..100)
 *
 * Também devolvemos um "tone" (healthy/busy/overloaded) pronto para o
 * frontend aplicar cor sem recalcular thresholds. A régua é:
 *   < 60%   healthy   (verde)
 *   60–85%  busy      (âmbar)
 *   > 85%   overloaded (vermelho)
 *
 * Para admins/managers, calculamos a média da equipe para o dashboard,
 * mas o endpoint do Inbox é focado no próprio usuário — basta a carga
 * dele aqui (ADMIN vendo o Inbox é atendente como todo mundo).
 */

// Default razoável baseado em benchmarks de SaaS (Intercom/Zendesk sugerem
// 15-25 conversas abertas simultâneas por agente em chat síncrono).
const DEFAULT_MAX_CONCURRENT = 20;

export async function GET() {
  const r = await requireAuth();
  if (!r.ok) return r.response;
  const userId = r.session.user.id;

  const activeConversations = await prisma.conversation.count({
    where: {
      status: "OPEN",
      assignedToId: userId,
    },
  });

  const maxConcurrent = DEFAULT_MAX_CONCURRENT;
  const loadPct = Math.max(
    0,
    Math.min(100, Math.round((activeConversations / maxConcurrent) * 100)),
  );

  const tone: "healthy" | "busy" | "overloaded" =
    loadPct > 85 ? "overloaded" : loadPct >= 60 ? "busy" : "healthy";

  return NextResponse.json({
    activeConversations,
    maxConcurrent,
    loadPct,
    tone,
  });
}
