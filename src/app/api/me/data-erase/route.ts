import { compare } from "bcryptjs";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prismaBase } from "@/lib/prisma-base";
import { requestErase } from "@/services/lgpd";

/**
 * `POST /api/me/data-erase`
 *
 * Exerce o direito de eliminacao (LGPD Art. 18, VI / GDPR Art. 17).
 *
 * - Re-autenticacao por senha obrigatoria. Erase e irreversivel —
 *   sessao roubada nao deve disparar.
 * - User precisa digitar `confirm = "ERASE"` no body. Defesa em
 *   profundidade contra UI bugs.
 * - Anonimiza ao inves de DELETE pra preservar audit trail (ver
 *   `services/lgpd.ts`).
 * - Loga `data_erase_request` + `data_erase_complete` no audit log.
 *
 * Body: { password, confirm: "ERASE", reason?: string }
 *
 * Pos-success: o user fica sem login. UI deve forcar logout.
 *
 * @see docs/lgpd.md
 */
export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as
    | { id?: string; organizationId?: string | null; isSuperAdmin?: boolean }
    | undefined;
  if (!user?.id || !user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Super-admin nao pode auto-erase aqui — quebraria operacao da
  // EduIT. Se precisar erase de super-admin, fluxo manual via DBA.
  if (user.isSuperAdmin) {
    return NextResponse.json(
      { error: "Super-admins nao podem auto-erase via UI." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { password?: unknown; confirm?: unknown; reason?: unknown }
    | null;
  const password = typeof body?.password === "string" ? body.password : "";
  const confirm = typeof body?.confirm === "string" ? body.confirm : "";
  const reason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : undefined;
  if (!password || confirm !== "ERASE") {
    return NextResponse.json(
      { error: "Confirmacao invalida. Body precisa de { password, confirm: 'ERASE' }." },
      { status: 400 },
    );
  }

  const dbUser = await prismaBase.user.findUnique({
    where: { id: user.id },
    select: { hashedPassword: true, isErased: true },
  });
  if (!dbUser?.hashedPassword || dbUser.isErased) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ok = await compare(password, dbUser.hashedPassword);
  if (!ok) {
    return NextResponse.json({ error: "Senha incorreta." }, { status: 400 });
  }

  try {
    const result = await requestErase({
      userId: user.id,
      organizationId: user.organizationId,
      requestedById: user.id,
      reason,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao processar erase.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
