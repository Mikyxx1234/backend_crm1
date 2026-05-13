import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/lib/api-auth";
import { getVisibilityFilter } from "@/lib/visibility";
import {
  getConversations,
  getTabCounts,
  type InboxTab,
} from "@/services/conversations";

function parseIntParam(v: string | null, fallback: number) {
  if (v === null || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const statuses = new Set(["OPEN", "RESOLVED", "PENDING", "SNOOZED"]);
const validTabs = new Set<InboxTab>([
  "entrada", "esperando", "respondidas", "automacao", "finalizados", "erro",
]);
const validSortBy = new Set(["updatedAt", "createdAt", "unreadCount"]);

export async function GET(request: Request) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    const { searchParams } = new URL(request.url);

    if (searchParams.get("counts") === "1") {
      const user = authResult.user as { id: string; role: "ADMIN" | "MANAGER" | "MEMBER" };
      const visibility = await getVisibilityFilter(user);
      const counts = await getTabCounts(visibility.conversationWhere);
      if (user.role === "MEMBER") {
        return NextResponse.json({
          entrada: 0, esperando: counts.esperando, respondidas: counts.respondidas,
          automacao: 0, finalizados: 0, erro: 0,
        });
      }
      return NextResponse.json(counts);
    }

    const contactId = searchParams.get("contactId") ?? undefined;
    const tabRaw = searchParams.get("tab") ?? undefined;
    const tab = tabRaw && validTabs.has(tabRaw as InboxTab) ? (tabRaw as InboxTab) : undefined;

    const user = authResult.user as { id: string; role: "ADMIN" | "MANAGER" | "MEMBER" };
    const memberAllowedTabs = new Set<InboxTab>(["esperando", "respondidas"]);
    if (user.role === "MEMBER" && tab && !memberAllowedTabs.has(tab)) {
      return NextResponse.json({ message: "Sem permissão para esta aba." }, { status: 403 });
    }
    const statusRaw = searchParams.get("status") ?? undefined;
    const status = statusRaw && statuses.has(statusRaw)
      ? (statusRaw as "OPEN" | "RESOLVED" | "PENDING" | "SNOOZED")
      : undefined;
    const channel = searchParams.get("channel") ?? undefined;
    const page = parseIntParam(searchParams.get("page"), 1);
    const perPage = parseIntParam(searchParams.get("perPage"), 30);

    const ownerId = searchParams.get("ownerId") ?? undefined;
    const stageId = searchParams.get("stageId") ?? undefined;
    const tagIdsRaw = searchParams.get("tagIds") ?? "";
    const tagIds = tagIdsRaw ? tagIdsRaw.split(",").filter(Boolean) : undefined;
    const sortByRaw = searchParams.get("sortBy") ?? undefined;
    const sortBy = sortByRaw && validSortBy.has(sortByRaw)
      ? (sortByRaw as "updatedAt" | "createdAt" | "unreadCount")
      : undefined;
    const sortOrderRaw = searchParams.get("sortOrder") ?? undefined;
    const sortOrder = sortOrderRaw === "asc" ? "asc" : sortOrderRaw === "desc" ? "desc" : undefined;

    const visibility = await getVisibilityFilter(user);

    const result = await getConversations({
      contactId, status, channel, tab, page, perPage,
      visibilityWhere: visibility.conversationWhere,
      ownerId, stageId, tagIds, sortBy, sortOrder,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao listar conversas." }, { status: 500 });
  }
}
