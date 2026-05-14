import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { updateBranding } from "@/services/onboarding";

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
    await updateBranding(orgId, {
      logoUrl: typeof b.logoUrl === "string" ? b.logoUrl : null,
      primaryColor: typeof b.primaryColor === "string" ? b.primaryColor : null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao salvar branding.";
    return NextResponse.json({ message: msg }, { status: 400 });
  }
}
