/**
 * GET /api/whatsapp/health
 * Retorna o estado de saúde do número WhatsApp Business configurado.
 * Usado por banner global no dashboard pra avisar antes que envios
 * falhem silenciosamente. Qualquer usuário autenticado pode ler
 * (operadores precisam ver o aviso em qualquer página).
 *
 * POST /api/whatsapp/health/refresh não existe — mas `?force=1` força
 * revalidação e só é aceita para admin/manager, para evitar abuso.
 */

import { NextResponse } from "next/server";

import { requireAuth, isManagerOrAdmin } from "@/lib/auth-helpers";
import { getWhatsAppHealth } from "@/services/whatsapp-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const r = await requireAuth();
  if (!r.ok) return r.response;

  const url = new URL(request.url);
  const forceParam = url.searchParams.get("force");
  const force = (forceParam === "1" || forceParam === "true") && isManagerOrAdmin(r.session);

  const status = await getWhatsAppHealth({ force });
  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
