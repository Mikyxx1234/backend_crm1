import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import { createGroup, listGroups } from "@/services/groups";

const levelEnum = z.enum(["NONE", "SELF", "TEAM", "ALL"]);

const scopedPermissionSchema = z.object({
  resource: z.string().min(1),
  action: z.string().min(1),
  level: levelEnum,
});

const stageGrantSchema = z.object({
  stageId: z.string().min(1),
  canView: z.boolean().optional(),
  canEdit: z.boolean().optional(),
});

const fieldGrantSchema = z.object({
  entity: z.string().min(1),
  fieldKey: z.string().min(1),
  canView: z.boolean().optional(),
  canEdit: z.boolean().optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  sharedInbox: z.boolean().optional(),
  mediaAccess: z.boolean().optional(),
  sidebarRoutes: z.array(z.string()).optional(),
  permissions: z.array(scopedPermissionSchema).optional(),
  stageGrants: z.array(stageGrantSchema).optional(),
  fieldGrants: z.array(fieldGrantSchema).optional(),
  memberIds: z.array(z.string().min(1)).optional(),
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

export async function GET() {
  return withOrgContext(async (session) => {
    if (!(await gate(session))) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "settings:permissions" },
        { status: 403 },
      );
    }
    try {
      const groups = await listGroups();
      return NextResponse.json(groups);
    } catch (e) {
      console.error("[GET /api/groups]", e);
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro ao listar grupos." },
        { status: 500 },
      );
    }
  });
}

export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    if (!(await gate(session))) {
      return NextResponse.json(
        { message: "Acesso negado.", required: "settings:permissions" },
        { status: 403 },
      );
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Dados inválidos.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    try {
      const group = await createGroup(parsed.data);
      return NextResponse.json(group, { status: 201 });
    } catch (e) {
      console.error("[POST /api/groups]", e);
      const msg = e instanceof Error ? e.message : "Erro ao criar grupo.";
      const status = msg.includes("Unique constraint") ? 409 : 500;
      return NextResponse.json({ message: status === 409 ? "Já existe um grupo com esse nome." : msg }, { status });
    }
  });
}
