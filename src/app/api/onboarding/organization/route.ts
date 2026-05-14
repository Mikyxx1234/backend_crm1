import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { updateOrganizationBasics } from "@/services/onboarding";

export async function PATCH(request: Request) {
  const r = await requireAuth();
  if (!r.ok) return r.response;
  const orgId = r.session.user.organizationId;
  if (!orgId) {
    return NextResponse.json({ message: "Sem organização." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  try {
    await updateOrganizationBasics(orgId, {
      name: typeof b.name === "string" ? b.name : undefined,
      industry: typeof b.industry === "string" ? b.industry : null,
      size: typeof b.size === "string" ? b.size : null,
      phone: typeof b.phone === "string" ? b.phone : null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao atualizar.";
    return NextResponse.json({ message: msg }, { status: 400 });
  }
}
