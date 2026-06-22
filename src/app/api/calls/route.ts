import { NextResponse } from "next/server";

import type { CallDirection, CallStatus } from "@prisma/client";
import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import { listCalls } from "@/services/calls";

/**
 * GET /api/calls
 * Lista chamadas da org com filtros opcionais.
 * RBAC: call:view
 *
 * Query params:
 *   extensionId  — filtrar por ramal
 *   direction    — INBOUND | OUTBOUND
 *   contactId    — filtrar por contato
 *   status       — RINGING | ANSWERED | COMPLETED | MISSED | BUSY | FAILED
 *   page         — página (default 1)
 *   perPage      — itens por página (default 20, max 100)
 */
export async function GET(request: Request) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    const denied = await requirePermissionForUser(authResult.user, "call:view");
    if (denied) return denied;

    const url = new URL(request.url);

    const VALID_DIRECTIONS = new Set<CallDirection>(["INBOUND", "OUTBOUND"]);
    const VALID_STATUSES = new Set<CallStatus>([
      "RINGING", "ANSWERED", "COMPLETED", "MISSED", "BUSY", "FAILED",
    ]);

    const rawDirection = url.searchParams.get("direction")?.toUpperCase();
    const rawStatus    = url.searchParams.get("status")?.toUpperCase();

    const filters = {
      extensionId: url.searchParams.get("extensionId") ?? undefined,
      direction:   (rawDirection && VALID_DIRECTIONS.has(rawDirection as CallDirection)
        ? rawDirection as CallDirection
        : undefined),
      contactId:   url.searchParams.get("contactId")   ?? undefined,
      status:      (rawStatus && VALID_STATUSES.has(rawStatus as CallStatus)
        ? rawStatus as CallStatus
        : undefined),
      page:        Number(url.searchParams.get("page"))    || 1,
      perPage:     Number(url.searchParams.get("perPage")) || 20,
    };

    try {
      const result = await listCalls(filters);
      return NextResponse.json(result);
    } catch (e) {
      console.error("[calls] GET:", e);
      return NextResponse.json({ message: "Erro ao listar chamadas." }, { status: 500 });
    }
  });
}
