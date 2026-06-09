/**
 * GET /api/users/[id]/effective-permissions
 *
 * Retorna as permissões efetivas do usuário no contexto da organização.
 * Usado pelo frontend (use-my-permissions.ts / useCan) para controle de
 * acesso no cliente.
 *
 * Estrutura de retorno:
 *   { permissions, channelGrants, stageGrants, roles, groups }
 *
 * - ADMIN / super-admin recebem permissions = ["*"] (acesso total).
 * - Usuário pode consultar apenas as próprias permissões (ou ADMIN vê de outros).
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { prismaBase } from "@/lib/prisma-base";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return withOrgContext(async (session) => {
    try {
      const { id } = await ctx.params;

      const requesterId = session.user.id;
      const requesterCtx = await loadAuthzContext({
        userId: requesterId,
        organizationId: session.user.organizationId,
        isSuperAdmin: session.user.isSuperAdmin,
      });
      const canAuditOthers = can(requesterCtx, "settings:permissions");
      if (requesterId !== id && !canAuditOthers) {
        return NextResponse.json({ message: "Acesso negado." }, { status: 403 });
      }

      const user = await prismaBase.user.findUnique({
        where: { id },
        select: {
          id: true,
          role: true,
          organizationId: true,
          isSuperAdmin: true,
        },
      });

      if (!user) {
        return NextResponse.json(
          { message: "Usuário não encontrado." },
          { status: 404 },
        );
      }

      const authzCtx = await loadAuthzContext({
        userId: user.id,
        organizationId: user.organizationId,
        isSuperAdmin: user.isSuperAdmin ?? false,
      });

      // Super-admin ou admin recebem "*" para que useCan() funcione no client.
      // Para outros usuários, retornamos as permissions efetivas do Set.
      let permissions: string[];
      if (authzCtx.isSuperAdmin || authzCtx.isAdmin) {
        permissions = ["*"];
      } else if (authzCtx.permissions.size > 0) {
        permissions = Array.from(authzCtx.permissions);
      } else {
        // Fallback: se não há assignments ainda (usuário criado antes do seed de RBAC),
        // deriva permissões do campo User.role legado.
        const legacyRole = user.role;
        if (legacyRole === "ADMIN") {
          permissions = ["*"];
        } else if (legacyRole === "MANAGER") {
          // MANAGER preset — retorna uma lista representativa das ações principais.
          permissions = [
            "pipeline:view", "pipeline:create", "pipeline:edit", "pipeline:delete", "pipeline:manage_stages",
            "contact:view", "contact:create", "contact:edit", "contact:delete", "contact:export", "contact:import",
            "deal:view", "deal:create", "deal:edit", "deal:delete", "deal:transfer_owner", "deal:change_stage",
            "conversation:view", "conversation:claim", "conversation:reassign_others", "conversation:resolve",
            "automation:view", "automation:create", "automation:edit", "automation:publish",
            "distribution:view", "distribution:manage", "distribution:execute",
            "report:view", "report:export",
            "settings:team", "settings:branding", "settings:channels", "settings:custom_fields",
            "tag:view", "tag:create", "tag:edit",
            "task:view", "task:create", "task:edit", "task:complete_others",
          ];
        } else {
          // MEMBER
          permissions = [
            "pipeline:view",
            "contact:view", "contact:create", "contact:edit",
            "deal:view", "deal:create", "deal:edit", "deal:change_stage",
            "conversation:view", "conversation:claim", "conversation:resolve",
            "tag:view",
            "task:view", "task:create", "task:edit",
            "report:view",
            "distribution:view",
          ];
        }
      }

      // Roles atribuídas ao usuário na organização.
      const assignments = await prismaBase.userRoleAssignment.findMany({
        where: {
          userId: id,
          organizationId: user.organizationId ?? undefined,
        },
        select: {
          role: { select: { id: true, name: true, systemPreset: true } },
        },
      });

      const roles = assignments.map((a) => ({
        id: a.role.id,
        name: a.role.name,
        systemPreset: a.role.systemPreset,
      }));

      return NextResponse.json({
        permissions,
        channelGrants: [],
        stageGrants: [],
        roles,
        groups: [],
      });
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro." },
        { status: 500 },
      );
    }
  });
}
