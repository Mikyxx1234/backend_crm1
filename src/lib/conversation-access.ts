import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import type { AppUserRole } from "@/lib/auth-types";
import { listAllowedChannelIds } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";
import { getVisibilityFilter } from "@/lib/visibility";

type SessionUser = { id: string; role: AppUserRole };

/** Verifica se o usuário pode listar/ver esta conversa (mesma regra da API GET /conversations). */
export async function userHasConversationAccess(
  user: SessionUser,
  conversationId: string
): Promise<boolean> {
  const { conversationWhere } = await getVisibilityFilter(user);
  const conditions: Prisma.ConversationWhereInput[] = [{ id: conversationId }];
  if (conversationWhere && Object.keys(conversationWhere).length > 0) {
    conditions.push(conversationWhere);
  }
  // Escopo de canais por usuário (mesma regra do GET /conversations).
  const allowedChannelIds = await listAllowedChannelIds({
    id: user.id,
    role: user.role,
    organizationId: getOrgIdOrThrow(),
  });
  if (allowedChannelIds) {
    conditions.push({ channelId: { in: allowedChannelIds } });
  }
  const n = await prisma.conversation.count({ where: { AND: conditions } });
  return n > 0;
}

/**
 * Retorna null se OK; caso contrário NextResponse 401/404 (404 para não vazar existência).
 */
export async function requireConversationAccess(
  session: { user?: { id?: string; role?: AppUserRole } } | null,
  conversationId: string
): Promise<NextResponse | null> {
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }
  const role = session.user.role;
  if (!role) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }
  const user = { id: session.user.id, role };
  const ok = await userHasConversationAccess(user, conversationId);
  if (!ok) {
    return NextResponse.json(
      { message: "Conversa não encontrada ou sem permissão." },
      { status: 404 }
    );
  }
  return null;
}
