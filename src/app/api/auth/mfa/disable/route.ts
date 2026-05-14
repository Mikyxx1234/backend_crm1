import { NextResponse } from "next/server";
import { compare } from "bcryptjs";

import { auth } from "@/lib/auth";
import { prismaBase } from "@/lib/prisma-base";
import { logAudit } from "@/lib/audit/log";

/**
 * POST /api/auth/mfa/disable
 *
 * Desabilita MFA do usuario logado. Exige RE-AUTENTICACAO (senha) no
 * body pra evitar abuso por sessao roubada / sessao deixada aberta.
 *
 * Body: { password: "..." }
 *
 * Side-effects:
 *   - mfaSecret = null
 *   - mfaEnabledAt = null
 *   - todos os backup codes deletados
 *
 * Pra TROCAR de autenticador (mesmo user, novo secret), o fluxo e:
 *   1) POST /disable com senha
 *   2) POST /setup
 *   3) POST /verify
 *
 * @see docs/mfa-totp.md
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { password?: unknown }
    | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) {
    return NextResponse.json(
      { error: "Senha obrigatoria pra desabilitar MFA." },
      { status: 400 },
    );
  }

  const user = await prismaBase.user.findUnique({
    where: { id: userId },
    select: { hashedPassword: true, mfaEnabledAt: true },
  });
  if (!user || !user.hashedPassword) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const passOk = await compare(password, user.hashedPassword);
  if (!passOk) {
    return NextResponse.json(
      { error: "Senha incorreta." },
      { status: 400 },
    );
  }

  await prismaBase.$transaction([
    prismaBase.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabledAt: null },
    }),
    prismaBase.userMfaBackupCode.deleteMany({ where: { userId } }),
  ]);

  await logAudit({
    entity: "user",
    action: "mfa_disable",
    entityId: userId,
    actorEmail: session?.user?.email ?? null,
  });

  return NextResponse.json({ disabled: true });
}
