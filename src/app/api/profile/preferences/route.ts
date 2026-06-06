/**
 * GET /api/profile/preferences
 * Preferencias pessoais do usuario autenticado: `sidebar` e `dashboard`.
 * Se nunca salvou, retorna o padrao (catalogo, todos habilitados).
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  getDashboardPreferences,
  getSidebarPreferences,
} from "@/services/user-preferences";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  try {
    const [sidebar, dashboard] = await Promise.all([
      getSidebarPreferences(session.user.id),
      getDashboardPreferences(session.user.id),
    ]);
    return NextResponse.json({ sidebar, dashboard });
  } catch (e) {
    console.error("[GET /api/profile/preferences]", e);
    return NextResponse.json(
      { message: "Erro ao carregar preferências." },
      { status: 500 },
    );
  }
}
