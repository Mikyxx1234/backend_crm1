import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prismaBase } from "@/lib/prisma-base";
import { verifyTotp } from "@/lib/auth/totp";
import { decryptSecret } from "@/lib/crypto/secrets";
import { generateBackupCodes } from "@/lib/auth/backup-codes";
import { logAudit } from "@/lib/audit/log";

/**
 * POST /api/auth/mfa/verify
 *
 * Confirma o setup de MFA. Chamar APOS POST /setup, com o codigo de
 * 6 digitos do app autenticador.
 *
 * Body: { code: "123456" }
 *
 * Em sucesso:
 *   1. Marca `mfaEnabledAt = now()` no User.
 *   2. Gera 10 codigos de backup, persiste hashes, retorna plaintexts.
 *   3. UI deve mostrar os plaintexts UMA UNICA VEZ pro usuario salvar.
 *
 * Em falha (codigo invalido): 400. O secret continua salvo — o user
 * pode tentar de novo. Nao incrementa lockout (a rota nao e exposta
 * pra atacante anonimo, ja exige sessao).
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
    | { code?: unknown }
    | null;
  const code =
    typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: "Codigo invalido. Esperado 6 digitos." },
      { status: 400 },
    );
  }

  const user = await prismaBase.user.findUnique({
    where: { id: userId },
    select: { mfaSecret: true, mfaEnabledAt: true },
  });
  if (!user || !user.mfaSecret) {
    return NextResponse.json(
      { error: "Setup nao iniciado. Chame POST /api/auth/mfa/setup primeiro." },
      { status: 400 },
    );
  }
  if (user.mfaEnabledAt) {
    return NextResponse.json(
      { error: "MFA ja habilitada." },
      { status: 409 },
    );
  }

  const secret = decryptSecret(user.mfaSecret);
  if (!verifyTotp(secret, code)) {
    return NextResponse.json(
      { error: "Codigo nao confere. Verifique o relogio do dispositivo." },
      { status: 400 },
    );
  }

  // Gera codigos de backup atomicamente com habilitacao.
  const { plaintexts, hashes } = await generateBackupCodes();
  await prismaBase.$transaction([
    prismaBase.user.update({
      where: { id: userId },
      data: { mfaEnabledAt: new Date() },
    }),
    prismaBase.userMfaBackupCode.deleteMany({ where: { userId } }),
    prismaBase.userMfaBackupCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    }),
  ]);

  await logAudit({
    entity: "user",
    action: "mfa_enable",
    entityId: userId,
    actorEmail: session?.user?.email ?? null,
    metadata: { backupCodesGenerated: plaintexts.length },
  });

  return NextResponse.json({
    enabled: true,
    backupCodes: plaintexts,
    notice:
      "Salve estes codigos em local seguro. Eles serao mostrados UMA UNICA VEZ.",
  });
}
