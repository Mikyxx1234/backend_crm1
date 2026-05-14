import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prismaBase } from "@/lib/prisma-base";
import { generateTotpSecret, buildOtpauthUri } from "@/lib/auth/totp";
import { encryptSecret } from "@/lib/crypto/secrets";

/**
 * POST /api/auth/mfa/setup
 *
 * Inicia setup de MFA TOTP.
 *
 * Body: vazio.
 *
 * Comportamento:
 * - Gera secret base32 (160 bits).
 * - Encripta com KEYRING_SECRET e salva em User.mfaSecret.
 * - **NAO** seta `mfaEnabledAt` ainda — so apos verify bem-sucedido
 *   na rota POST /verify. Se o usuario abandonar o setup, o secret
 *   fica orfao mas inerte (login nao exige MFA).
 * - Retorna o secret em plaintext + URI otpauth:// pra QR Code.
 *
 * Idempotencia:
 * - Se o user ja tem MFA HABILITADO (mfaEnabledAt != null), retorna 409.
 *   Pra trocar de autenticador, o user precisa primeiro disable.
 * - Se o user iniciou setup mas nao concluiu (mfaSecret presente,
 *   mfaEnabledAt null), gera secret novo e sobrescreve.
 *
 * @see docs/mfa-totp.md
 */
export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (!userId || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prismaBase.user.findUnique({
    where: { id: userId },
    select: { mfaEnabledAt: true, email: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.mfaEnabledAt) {
    return NextResponse.json(
      { error: "MFA ja habilitada. Desabilite primeiro." },
      { status: 409 },
    );
  }

  const plain = generateTotpSecret();
  const encrypted = encryptSecret(plain);

  await prismaBase.user.update({
    where: { id: userId },
    data: { mfaSecret: encrypted },
  });

  const uri = buildOtpauthUri({
    issuer: "CRM EduIT",
    account: user.email,
    secret: plain,
  });

  return NextResponse.json({
    secret: plain,
    otpauthUri: uri,
  });
}
