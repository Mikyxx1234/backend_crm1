import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { inviteTeamMembers } from "@/services/onboarding";

export async function POST(request: Request) {
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
  const raw = Array.isArray(b.members) ? b.members : [];
  const members = raw
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const mo = m as Record<string, unknown>;
      const email = typeof mo.email === "string" ? mo.email : "";
      const role =
        typeof mo.role === "string" && Object.values(UserRole).includes(mo.role as UserRole)
          ? (mo.role as UserRole)
          : UserRole.MEMBER;
      return { email, role };
    })
    .filter((m): m is { email: string; role: UserRole } => Boolean(m && m.email));

  try {
    const res = await inviteTeamMembers(orgId, r.session.user.id, members);
    return NextResponse.json(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao gerar convites.";
    return NextResponse.json({ message: msg }, { status: 400 });
  }
}
