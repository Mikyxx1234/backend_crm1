import { NextResponse } from "next/server";

import { getClientIp, withRateLimit } from "@/lib/rate-limit";
import { acceptMemberInvite } from "@/services/onboarding";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Endpoint NÃO autenticado — rate-limit por IP pra prevenir enumeração
  // de tokens de convite (atacante tentando força-bruta).
  const rl = await withRateLimit({
    route: "/api/invites/accept",
    profile: "auth.invite",
    scope: "ip",
    id: getClientIp(request),
  });
  if (!rl.ok) return rl.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "JSON inválido." },
      { status: 400, headers: rl.headers },
    );
  }
  const b = body as Record<string, unknown>;
  const token = typeof b.token === "string" ? b.token : "";
  const name = typeof b.name === "string" ? b.name : "";
  const password = typeof b.password === "string" ? b.password : "";

  try {
    const res = await acceptMemberInvite({ token, name, password });
    return NextResponse.json(res, { status: 201, headers: rl.headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao aceitar convite.";
    return NextResponse.json({ message: msg }, { status: 400, headers: rl.headers });
  }
}
