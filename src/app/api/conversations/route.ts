import { NextResponse } from "next/server";

import { withApiAuthContext } from "@/lib/api-auth";
import { loadAuthzContext } from "@/lib/authz";
import { canSeeInboxTab, getScopeGrants } from "@/lib/authz/scope-grants";
import { listAllowedChannelIds } from "@/lib/authz/resource-policy";
import { getVisibilityFilter } from "@/lib/visibility";
import {
  getConversations,
  getTabCounts,
  INBOX_CATEGORY_TABS,
  INBOX_TAB_LIST,
  type InboxCategoryTab,
  type InboxTab,
} from "@/services/conversations";

function parseIntParam(v: string | null, fallback: number) {
  if (v === null || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const statuses = new Set(["OPEN", "RESOLVED", "PENDING", "SNOOZED"]);
const validTabs = new Set<InboxTab>([
  "entrada",
  "esperando",
  "respondidas",
  "automacao",
  "finalizados",
  "erro",
  "todos",
]);
const validSortBy = new Set(["updatedAt", "createdAt", "unreadCount"]);

// Bug 24/abr/26: usavamos authenticateApiRequest direto + enterRequestContext,
// mas enterWith() perde o store quando o caller resume apos `await` (Next.js
// usa async resources que nao herdam o enterWith retroativamente). A forma
// CONFIAVEL eh runWithContext envolvendo o handler todo — o que withApiAuthContext
// faz. Usar esse wrapper aqui resolveu "Erro ao listar conversas." em prod.
export async function GET(request: Request) {
  return withApiAuthContext(request, async (apiUser) => {
    try {
      const { searchParams } = new URL(request.url);
      const user = { id: apiUser.id, role: apiUser.role as "ADMIN" | "MANAGER" | "MEMBER" };
      const grants = await getScopeGrants();
      const allowedChannelIds = await listAllowedChannelIds(apiUser);

      // Permissões efetivas (Authz v2) — conectam as roles custom ao gating de
      // abas do inbox. Admin/super-admin recebem `*` (todas as abas). Sem isso,
      // um MEMBER com role custom concedendo `conversation:view` continuaria
      // preso ao default legado (só "esperando"/"respondidas").
      const authz = await loadAuthzContext({
        userId: apiUser.id,
        organizationId: apiUser.organizationId,
        isSuperAdmin: apiUser.isSuperAdmin,
      });
      const inboxPerms: ReadonlySet<string> =
        authz.isSuperAdmin || authz.isAdmin ? new Set(["*"]) : authz.permissions;

      if (searchParams.get("counts") === "1") {
        const visibility = await getVisibilityFilter(user);
        const memberCategoryTabs: InboxCategoryTab[] | null =
          user.role === "MEMBER"
            ? (() => {
                const tabs = INBOX_CATEGORY_TABS.filter((t) =>
                  canSeeInboxTab({ grants, role: user.role, tab: t, permissions: inboxPerms }),
                );
                return tabs.length > 0 ? [...tabs] : (["esperando", "respondidas"] as InboxCategoryTab[]);
              })()
            : null;
        const counts = await getTabCounts(
          visibility.conversationWhere,
          memberCategoryTabs,
          allowedChannelIds,
        );
        if (user.role === "MEMBER") {
          const masked = { ...counts };
          for (const key of INBOX_TAB_LIST) {
            if (!canSeeInboxTab({ grants, role: user.role, tab: key, permissions: inboxPerms })) {
              masked[key] = 0;
            }
          }
          return NextResponse.json(masked);
        }
        return NextResponse.json(counts);
      }

      const contactId = searchParams.get("contactId") ?? undefined;
      const tabRaw = searchParams.get("tab") ?? undefined;
      const tab = tabRaw && validTabs.has(tabRaw as InboxTab) ? (tabRaw as InboxTab) : undefined;

      if (tab && !canSeeInboxTab({ grants, role: user.role, tab, permissions: inboxPerms })) {
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
      const withoutOwner =
        searchParams.get("withoutOwner") === "1" ||
        searchParams.get("withoutOwner") === "true";
      const stageId = searchParams.get("stageId") ?? undefined;
      const tagIdsRaw = searchParams.get("tagIds") ?? "";
      const tagIds = tagIdsRaw ? tagIdsRaw.split(",").filter(Boolean) : undefined;
      const sourcesRaw = searchParams.get("sources") ?? "";
      const sources = sourcesRaw
        ? sourcesRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      const withoutSource =
        searchParams.get("withoutSource") === "1" ||
        searchParams.get("withoutSource") === "true";
      const sortByRaw = searchParams.get("sortBy") ?? undefined;
      const sortBy = sortByRaw && validSortBy.has(sortByRaw)
        ? (sortByRaw as "updatedAt" | "createdAt" | "unreadCount")
        : undefined;
      const sortOrderRaw = searchParams.get("sortOrder") ?? undefined;
      const sortOrder = sortOrderRaw === "asc" ? "asc" : sortOrderRaw === "desc" ? "desc" : undefined;
      const searchRaw = searchParams.get("search") ?? searchParams.get("q") ?? "";
      const search =
        typeof searchRaw === "string" && searchRaw.trim().length > 0 ? searchRaw.trim() : undefined;

      const visibility = await getVisibilityFilter(user);

      const memberTodosCategories: InboxCategoryTab[] | undefined =
        tab === "todos" && user.role === "MEMBER"
          ? (() => {
              const tabs = INBOX_CATEGORY_TABS.filter((t) =>
                canSeeInboxTab({ grants, role: user.role, tab: t, permissions: inboxPerms }),
              );
              return tabs.length > 0 ? [...tabs] : (["esperando", "respondidas"] as InboxCategoryTab[]);
            })()
          : undefined;

      const result = await getConversations({
        contactId,
        status,
        channel,
        tab,
        todosCategoryTabs: memberTodosCategories,
        search,
        page,
        perPage,
        visibilityWhere: visibility.conversationWhere,
        ownerId,
        withoutOwner,
        stageId,
        tagIds,
        sources,
        withoutSource,
        sortBy,
        sortOrder,
        allowedChannelIds,
      });

      return NextResponse.json(result);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ message: "Erro ao listar conversas." }, { status: 500 });
    }
  });
}
