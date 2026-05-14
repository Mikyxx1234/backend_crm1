import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prismaBase } from "@/lib/prisma-base";

/**
 * GET /api/auth/mfa/status
 *
 * Status MFA do usuario logado (pra UI de /settings/security).
 *
 * Resposta:
 *   { enabled: boolean, enabledAt?: ISO, backupCodesRemaining: number,
 *     setupInProgress: boolean }
 *
 * `setupInProgress` = mfaSecret presente mas mfaEnabledAt null —
 * usuario abandonou o setup, UI sugere recomecar.
 *
 * @see docs/mfa-totp.md
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prismaBase.user.findUnique({
    where: { id: userId },
    select: { mfaSecret: true, mfaEnabledAt: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const remaining = await prismaBase.userMfaBackupCode.count({
    where: { userId, usedAt: null },
  });

  return NextResponse.json({
    enabled: Boolean(user.mfaEnabledAt),
    enabledAt: user.mfaEnabledAt?.toISOString() ?? null,
    backupCodesRemaining: remaining,
    setupInProgress: Boolean(user.mfaSecret) && !user.mfaEnabledAt,
  });
}
