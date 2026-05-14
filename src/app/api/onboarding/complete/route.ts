import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { completeOnboarding } from "@/services/onboarding";

export async function POST() {
  const r = await requireAuth();
  if (!r.ok) return r.response;
  const orgId = r.session.user.organizationId;
  if (!orgId) {
    return NextResponse.json({ message: "Sem organização." }, { status: 400 });
  }
  await completeOnboarding(orgId);
  return NextResponse.json({ ok: true });
}
