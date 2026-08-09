import { NextResponse } from "next/server";

import { withOrgContext, requireAuthWithCtx } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { listAllowedChannelIds, listAllowedPipelineIds } from "@/lib/authz/resource-policy";
import { canSeeInboxTab, getScopeGrants } from "@/lib/authz/scope-grants";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import {
  getDepartmentScopeForConversations,
  getVisibilityFilter,
  getVisibilitySettings,
  withInboxQueueVisibility,
} from "@/lib/visibility";
import {
  getTabCounts,
  INBOX_CATEGORY_TABS,
  type InboxCategoryTab,
  type InboxTab,
} from "@/services/conversations";

/**
 * Por que a caixa de entrada (ou o funil) de um usuário aparece vazia.
 *
 * Cada camada — visibilidade do papel, filas da inbox, escopo de canais,
 * escopo de departamento, gating de abas — sozinha consegue zerar a lista, e
 * todas falham em silêncio: o operador só vê "Nenhuma conversa encontrada".
 * Reproduzir isso fora do ambiente real é inviável porque o resultado depende
 * inteiramente dos grants gravados na org. Esta rota roda as MESMAS funções da
 * listagem para um usuário alvo e conta quantas conversas sobrevivem a cada
 * camada, isolando qual delas zera.
 *
 * Somente leitura, restrita a quem administra permissões.
 * GET /api/settings/permissions/diagnose?email=... (ou ?userId=...)
 */
export async function GET(request: Request) {
  return withOrgContext(async () => {
    const authz = await requireAuthWithCtx();
    if (!authz.ok) return authz.response;
    if (!can(authz.ctx, "settings:permissions")) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email")?.trim().toLowerCase();
    const userId = searchParams.get("userId")?.trim();
    if (!email && !userId) {
      return NextResponse.json(
        { message: "Informe ?email= ou ?userId= do usuário a diagnosticar." },
        { status: 400 },
      );
    }

    // `prismaBase` + filtro explícito de org: a listagem de usuários não é
    // escopada pela extension, e um admin só pode auditar a própria org.
    const target = await prismaBase.user.findFirst({
      where: {
        organizationId: authz.session.user.organizationId ?? undefined,
        ...(userId ? { id: userId } : { email }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        type: true,
        isSuperAdmin: true,
        organizationId: true,
      },
    });
    if (!target) {
      return NextResponse.json({ message: "Usuário não encontrado nesta organização." }, { status: 404 });
    }

    const role = target.role as "ADMIN" | "MANAGER" | "MEMBER";
    const userLike = {
      id: target.id,
      role,
      organizationId: target.organizationId,
      isSuperAdmin: target.isSuperAdmin,
    };

    const targetCtx = await loadAuthzContext({
      userId: target.id,
      organizationId: target.organizationId,
      isSuperAdmin: target.isSuperAdmin,
    });
    const permissions: ReadonlySet<string> =
      targetCtx.isSuperAdmin || targetCtx.isAdmin ? new Set(["*"]) : targetCtx.permissions;

    const [grants, visibilitySettings, scopeFlag, deptScope, allowedChannelIds, allowedPipelineIds] =
      await Promise.all([
        getScopeGrants(),
        getVisibilitySettings(),
        target.organizationId
          ? isFeatureEnabled("rbac_granular_scope_v1", target.organizationId)
          : Promise.resolve(false),
        getDepartmentScopeForConversations({ id: target.id, role }),
        listAllowedChannelIds(userLike),
        listAllowedPipelineIds(userLike),
      ]);

    const roleAssignments = await prismaBase.userRoleAssignment.findMany({
      where: {
        userId: target.id,
        organizationId: target.organizationId ?? undefined,
      },
      select: {
        role: {
          select: { id: true, name: true, systemPreset: true, sharedInbox: true, permissions: true },
        },
      },
    });

    const visibility = await getVisibilityFilter({ id: target.id, role });
    const queueWhere = withInboxQueueVisibility(visibility.conversationWhere, { permissions });

    const visibleTabs = (["todos", ...INBOX_CATEGORY_TABS] as InboxTab[]).filter((tab) =>
      canSeeInboxTab({ grants, role, tab, permissions }),
    );
    const memberCategoryTabs: InboxCategoryTab[] | null =
      role === "MEMBER"
        ? (() => {
            const tabs = INBOX_CATEGORY_TABS.filter((t) =>
              canSeeInboxTab({ grants, role, tab: t, permissions }),
            );
            return tabs.length > 0 ? [...tabs] : (["esperando", "respondidas"] as InboxCategoryTab[]);
          })()
        : null;

    // Funil de contagens: cada linha acrescenta UMA camada à anterior, então a
    // primeira que cai a zero é a responsável pela fila vazia.
    const [atribuidasAoUsuario, aposVisibilidade, aposFilasDaInbox, aposEscopoDeCanais] =
      await Promise.all([
        prisma.conversation.count({ where: { assignedToId: target.id } }),
        prisma.conversation.count({ where: visibility.conversationWhere }),
        prisma.conversation.count({ where: queueWhere }),
        prisma.conversation.count({
          where: allowedChannelIds
            ? { AND: [queueWhere, { channelId: { in: allowedChannelIds } }] }
            : queueWhere,
        }),
      ]);

    const [abasComEscopoDeCanais, abasIgnorandoEscopoDeCanais] = await Promise.all([
      getTabCounts(queueWhere, memberCategoryTabs, allowedChannelIds, [], null),
      getTabCounts(queueWhere, memberCategoryTabs, null, [], null),
    ]);

    const [negociosDoUsuario, negociosVisiveis] = await Promise.all([
      prisma.deal.count({ where: { ownerId: target.id } }),
      prisma.deal.count({ where: visibility.dealWhere }),
    ]);

    // Ordem do veredito = ordem em que as camadas cortam. A primeira mensagem
    // é a causa; as seguintes só apareceriam depois de resolver a anterior.
    const veredito: string[] = [];
    if (target.type === "AI") {
      veredito.push("Usuário é do tipo IA — não usa a inbox humana.");
    }
    if (atribuidasAoUsuario === 0) {
      veredito.push(
        "Não há nenhuma conversa atribuída a este usuário no banco. O problema é de distribuição/atribuição, não de permissão.",
      );
    }
    if (aposVisibilidade === 0 && atribuidasAoUsuario > 0) {
      veredito.push(
        `A visibilidade do papel (${role} = "${visibilitySettings[role]}") zera a lista. ` +
          (deptScope
            ? `Há escopo de departamento ativo (${deptScope.join(", ")}) — conversas fora dele, ou sem departamento, ficam ocultas.`
            : "Sem escopo de departamento; revise o modo own/all da role."),
      );
    }
    if (allowedChannelIds && allowedChannelIds.length === 0) {
      veredito.push(
        'Escopo de canais definido como "Nenhum" (lista vazia): NENHUMA conversa passa, em nenhuma aba. ' +
          'Ajuste em Configurações → Permissões → usuário → Canais por capacidade → "Ver mensagens" para "Todos".',
      );
    } else if (allowedChannelIds && aposEscopoDeCanais === 0 && aposFilasDaInbox > 0) {
      veredito.push(
        `O escopo de canais (${allowedChannelIds.length} canal(is) liberado(s)) não cobre nenhuma das conversas visíveis.`,
      );
    }
    const tabsRule = grants.inbox?.tabs?.MEMBER;
    if (role === "MEMBER" && Array.isArray(tabsRule) && tabsRule.length === 0) {
      veredito.push(
        'Grant de abas do papel Operador está presente e vazio: toda aba fica bloqueada. Libere as abas ou remova a regra.',
      );
    }
    if (visibleTabs.length === 0) {
      veredito.push("Nenhuma aba da inbox está liberada para este usuário.");
    }
    // As conversas existem e passam por todos os filtros, mas moram numa aba
    // que o papel não enxerga — a fila fica vazia sem nenhum erro aparente.
    const abasBloqueadasComConversas = INBOX_CATEGORY_TABS.filter(
      (t) => abasComEscopoDeCanais[t] > 0 && !visibleTabs.includes(t),
    );
    if (abasBloqueadasComConversas.length > 0) {
      const detalhe = abasBloqueadasComConversas
        .map((t) => `${t} (${abasComEscopoDeCanais[t]})`)
        .join(", ");
      const sobreEntrada = abasBloqueadasComConversas.includes("entrada")
        ? ' "Entrada" é onde ficam as conversas já distribuídas mas ainda sem a primeira resposta humana — sem essa aba o operador não vê as próprias conversas recém-atribuídas.'
        : "";
      veredito.push(
        `Há conversas em abas que o papel NÃO enxerga: ${detalhe}. ` +
          `Libere em Configurações → Permissões → papel → Filas da Inbox.${sobreEntrada}`,
      );
    }
    if (veredito.length === 0) {
      veredito.push(
        `Nenhum bloqueio encontrado: ${aposEscopoDeCanais} conversa(s) deveriam aparecer. Se a tela está vazia, verifique filtros salvos no navegador do usuário e o cache de authz (~60s).`,
      );
    }

    return NextResponse.json({
      usuario: {
        id: target.id,
        nome: target.name,
        email: target.email,
        papelLegado: role,
        tipo: target.type,
        isSuperAdmin: target.isSuperAdmin,
      },
      papeisAtribuidos: roleAssignments.map((a) => ({
        id: a.role.id,
        nome: a.role.name,
        preset: a.role.systemPreset,
        caixaCompartilhada: a.role.sharedInbox,
        totalDePermissoes: a.role.permissions.length,
        filasDaInbox: a.role.permissions.filter((p) => p.startsWith("inbox:tab:")),
      })),
      permissoesEfetivas: Array.from(permissions).sort(),
      visibilidade: {
        configuracaoDaOrg: visibilitySettings,
        modoAplicado: visibilitySettings[role],
        canSeeAll: visibility.canSeeAll,
        conversationWhere: visibility.conversationWhere,
        dealWhere: visibility.dealWhere,
      },
      escopos: {
        featureRbacGranular: scopeFlag,
        departamentos: deptScope,
        canaisPermitidos: allowedChannelIds,
        funisPermitidos: allowedPipelineIds,
        grantsDeAbas: grants.inbox?.tabs ?? null,
        grantsDeCanais: grants.channel ?? null,
      },
      abas: { visiveis: visibleTabs, categoriasEmTodos: memberCategoryTabs },
      conversas: {
        atribuidasAoUsuario,
        aposVisibilidade,
        aposFilasDaInbox,
        aposEscopoDeCanais,
        porAba: abasComEscopoDeCanais,
        porAbaIgnorandoEscopoDeCanais: abasIgnorandoEscopoDeCanais,
      },
      negocios: { doUsuario: negociosDoUsuario, visiveis: negociosVisiveis },
      veredito,
    });
  });
}
