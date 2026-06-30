import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { prisma } from "@/lib/prisma";
import { resolveApi4ComDialToken } from "@/services/sip-extensions";
import { dialApi4ComCall } from "@/services/telephony-providers/api4com";

/**
 * POST /api/sip-extensions/dial-api4com
 *
 * Discagem de saída Api4Com via REST /dialer (fluxo webphone próprio).
 * O JsSIP no navegador deve estar registrado e auto-atender a chamada SIP
 * originada pelo PBX após este endpoint.
 *
 * Body:
 *   {
 *     phone?: string,           // E.164 (+55...). Opcional se dealId fornecido.
 *     dealId?: string,          // Quando presente, resolve phone do contato do deal
 *     contactId?: string        // Quando presente, dispara metadata.contact_id
 *   }
 *
 * Convenção de metadata enviada à Api4com (snake_case por convenção do PBX):
 *   { gateway, crm_user_id, deal_id?, contact_id? }
 * — Todos esses campos voltam no webhook channel-hangup, permitindo correlação
 * call ↔ deal ↔ contato (ver services/calls.ts e adapter api4com).
 *
 * RBAC: sip_extension:manage
 */
export async function POST(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "sip_extension:manage");
    if (denied) return denied;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    let phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const dealId = typeof body.dealId === "string" ? body.dealId.trim() : undefined;
    let contactId = typeof body.contactId === "string" ? body.contactId.trim() : undefined;

    // Se phone ausente, tenta resolver via dealId → contato do deal.
    if (!phone && dealId) {
      const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        select: {
          contactId: true,
          contact: { select: { id: true, phone: true } },
        },
      });
      if (deal?.contact?.phone) {
        phone = deal.contact.phone;
        if (!contactId) contactId = deal.contact.id;
      }
    }

    if (!phone) {
      return NextResponse.json(
        {
          ok: false,
          field: "phone",
          message:
            "Informe o número ou um dealId cujo contato tenha telefone cadastrado.",
        },
        { status: 400 },
      );
    }

    const dialAuth = await resolveApi4ComDialToken(authResult.user.id);
    if (!dialAuth) {
      return NextResponse.json(
        {
          ok: false,
          field: "email",
          message:
            "Credenciais Api4Com ausentes ou inválidas. Reconecte em Configurações → Softphone → Api4Com.",
        },
        { status: 400 },
      );
    }

    const result = await dialApi4ComCall(
      dialAuth.apiToken,
      dialAuth.extension,
      phone,
      {
        crm_user_id: authResult.user.id,
        ...(dealId ? { deal_id: dealId } : {}),
        ...(contactId ? { contact_id: contactId } : {}),
      },
      dialAuth.organizationId,
    );
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json({ ok: true, callId: result.callId ?? null });
  });
}
