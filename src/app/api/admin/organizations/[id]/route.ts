import { OrgStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/auth-helpers";
import {
  getOrganizationById,
  updateOrganizationStatus,
} from "@/services/organizations";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const r = await requireSuperAdmin();
  if (!r.ok) return r.response;

  const { id } = await ctx.params;
  const org = await getOrganizationById(id);
  if (!org) {
    return NextResponse.json(
      { message: "Organização não encontrada." },
      { status: 404 },
    );
  }
  return NextResponse.json({ organization: org });
}

export async function PATCH(request: Request, ctx: Ctx) {
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
  const statusRaw = typeof b.status === "string" ? b.status : "";
  if (!Object.values(OrgStatus).includes(statusRaw as OrgStatus)) {
    return NextResponse.json(
      { message: "Status inválido." },
      { status: 400 },
    );
  }

  try {
    await updateOrganizationStatus(id, statusRaw as OrgStatus);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao atualizar status.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
