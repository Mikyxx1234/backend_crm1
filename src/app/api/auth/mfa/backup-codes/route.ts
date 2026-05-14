import { NextResponse } from "next/server";
import { compare } from "bcryptjs";

import { auth } from "@/lib/auth";
import { prismaBase } from "@/lib/prisma-base";
import { generateBackupCodes } from "@/lib/auth/backup-codes";
import { logAudit } from "@/lib/audit/log";

/**
 * POST /api/auth/mfa/backup-codes
 *
 * Regenera o set de codigos de backup. Exige re-autenticacao (senha)
 * porque consumir essa rota INVALIDA todos os codigos antigos — se um
 * atacante tem a sessao mas nao a senha, nao consegue.
 *
 * Body: { password: "..." }
 *
 * Resposta: { backupCodes: ["AB12-...", ...] } — os codigos antigos
 * sao deletados e os novos sao mostrados UMA UNICA VEZ.
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
      { error: "Senha obrigatoria." },
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
  if (!user.mfaEnabledAt) {
    return NextResponse.json(
      { error: "MFA nao habilitada — habilite primeiro pra ter backup codes." },
      { status: 400 },
    );
  }
  const passOk = await compare(password, user.hashedPassword);
  if (!passOk) {
    return NextResponse.json(
      { error: "Senha incorreta." },
      { status: 400 },
    );
  }

  const { plaintexts, hashes } = await generateBackupCodes();
  await prismaBase.$transaction([
    prismaBase.userMfaBackupCode.deleteMany({ where: { userId } }),
    prismaBase.userMfaBackupCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    }),
  ]);

  await logAudit({
    entity: "user",
    action: "mfa_backup_codes_regenerate",
    entityId: userId,
    actorEmail: session?.user?.email ?? null,
    metadata: { count: plaintexts.length },
  });

  return NextResponse.json({ backupCodes: plaintexts });
}
