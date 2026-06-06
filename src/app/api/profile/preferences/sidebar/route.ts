/**
 * PATCH /api/profile/preferences/sidebar
 * Body: { items: [{ key: string, enabled: boolean, order: number }] }
 *
 * Salva a personalizacao da sidebar do usuario autenticado. O `userId` vem
 * SEMPRE da sessao (nunca do body). O service normaliza contra o catalogo:
 * descarta keys invalidas/sem permissao, forca itens `locked`, anexa itens
 * novos e reescreve a ordem. Retorna a versao final normalizada.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { saveSidebarPreferences } from "@/services/user-preferences";

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        enabled: z.boolean(),
        order: z.number().int().min(0).max(1000),
      }),
    )
    .max(100),
});

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Dados inválidos.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const sidebar = await saveSidebarPreferences(session.user.id, parsed.data.items);
    return NextResponse.json({ sidebar });
  } catch (e) {
    console.error("[PATCH /api/profile/preferences/sidebar]", e);
    return NextResponse.json(
      { message: "Erro ao salvar preferências." },
      { status: 500 },
    );
  }
}
