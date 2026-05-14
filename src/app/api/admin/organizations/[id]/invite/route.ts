import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/auth-helpers";
import { createInviteForOrganization } from "@/services/organizations";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const r = await requireSuperAdmin();
  if (!r.ok) return r.response;

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email : "";
  const roleRaw = typeof b.role === "string" ? b.role : UserRole.ADMIN;
  const role = Object.values(UserRole).includes(roleRaw as UserRole)
    ? (roleRaw as UserRole)
    : UserRole.ADMIN;

  try {
    const invite = await createInviteForOrganization({
      organizationId: id,
      email,
      role,
      createdById: r.session.user.id,
    });
    return NextResponse.json({ invite }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao criar convite.";
    return NextResponse.json({ message: msg }, { status: 400 });
  }
}
