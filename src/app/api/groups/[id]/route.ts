import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { deleteGroup, getGroupById, updateGroup } from "@/services/groups";

type RouteContext = { params: Promise<{ id: string }> };

const levelEnum = z.enum(["NONE", "SELF", "TEAM", "ALL"]);

const updateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
    sharedInbox: z.boolean().optional(),
    mediaAccess: z.boolean().optional(),
    sidebarRoutes: z.array(z.string()).optional(),
    permissions: z
      .array(
        z.object({
          resource: z.string().min(1),
          action: z.string().min(1),
          level: levelEnum,
        }),
      )
      .optional(),
    stageGrants: z
      .array(
        z.object({
          stageId: z.string().min(1),
          canView: z.boolean().optional(),
          canEdit: z.boolean().optional(),
        }),
      )
      .optional(),
    fieldGrants: z
      .array(
        z.object({
          entity: z.string().min(1),
          fieldKey: z.string().min(1),
          canView: z.boolean().optional(),
          canEdit: z.boolean().optional(),
        }),
      )
      .optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "Nenhum campo para atualizar.",
  });

async function gate(session: {
  user: { id: string; organizationId: string | null; isSuperAdmin: boolean };
}) {
  const ctx = await loadAuthzContext({
    userId: session.user.id,
    organizationId: session.user.organizationId,
    isSuperAdmin: session.user.isSuperAdmin,
  });
  return can(ctx, "settings:permissions");
}

export async function GET(_request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    if (!(await gate(session))) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "settings:permissions" },
        { status: 403 },
      );
    }
    const { id } = await context.params;
    try {
      const group = await getGroupById(id);
      if (!group) {
        return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
      }
      return NextResponse.json(group);
    } catch (e) {
      console.error("[GET /api/groups/[id]]", e);
      return NextResponse.json({ message: "Erro ao buscar grupo." }, { status: 500 });
    }
  });
}

export async function PUT(request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    if (!(await gate(session))) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "settings:permissions" },
        { status: 403 },
      );
    }
    const { id } = await context.params;
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const parsed = updateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Dados inválidos.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    try {
      const group = await updateGroup(id, parsed.data);
      if (!group) {
        return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
      }
      return NextResponse.json(group);
    } catch (e) {
      console.error("[PUT /api/groups/[id]]", e);
      const msg = e instanceof Error ? e.message : "Erro ao atualizar grupo.";
      const status = msg.includes("Unique constraint") ? 409 : 400;
      return NextResponse.json(
        { message: status === 409 ? "Já existe um grupo com esse nome." : msg },
        { status },
      );
    }
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  return withOrgContext(async (session) => {
    if (!(await gate(session))) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "settings:permissions" },
        { status: 403 },
      );
    }
    const { id } = await context.params;
    try {
      const result = await deleteGroup(id);
      if (!result) {
        return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
      }
      return NextResponse.json(result);
    } catch (e) {
      console.error("[DELETE /api/groups/[id]]", e);
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro ao excluir grupo." },
        { status: 400 },
      );
    }
  });
}
