import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getOrgIdOrThrow } from "@/lib/request-context";
import {
  enableTelephony,
  disableTelephony,
  getProvisioningStatus,
} from "@/services/api4com/provisioning";

type RouteContext = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  enabled: z.boolean(),
});

/**
 * PATCH /api/users/:id/telephony
 * Body: { "enabled": true|false }
 *
 * Provisiona ou desativa telefonia Api4com para o usuário informado.
 * Requer role ADMIN.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const r = await requireAdmin();
  if (!r.ok) return r.response;

  const { id: userId } = await context.params;
  const organizationId = getOrgIdOrThrow();

  const body = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Body inválido. Esperado: { enabled: boolean }." },
      { status: 400 },
    );
  }

  // Verificação cross-org: o userId deve pertencer à mesma organização.
  const userBelongs = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true },
  });
  if (!userBelongs) {
    return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
  }

  if (parsed.data.enabled) {
    const result = await enableTelephony(userId, organizationId);
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  }

  await disableTelephony(userId, organizationId);
  return NextResponse.json({ success: true, step: "DISABLED" });
}

/**
 * GET /api/users/:id/telephony
 * Retorna status de provisionamento.
 */
export async function GET(_request: Request, context: RouteContext) {
  const r = await requireAdmin();
  if (!r.ok) return r.response;

  const { id: userId } = await context.params;
  const organizationId = getOrgIdOrThrow();

  const userBelongs = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true },
  });
  if (!userBelongs) {
    return NextResponse.json({ message: "Usuário não encontrado." }, { status: 404 });
  }

  const status = await getProvisioningStatus(userId, organizationId);
  if (!status) {
    return NextResponse.json(
      { telephonyEnabled: false, provisioningStep: "IDLE", provisioningError: null, provisionedAt: null },
    );
  }
  return NextResponse.json(status);
}
