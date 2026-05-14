import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { revokeToken } from "@/services/api-tokens";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const session = await auth();
    const user = session?.user as
      | { id?: string; organizationId?: string | null }
      | undefined;
    if (!user?.id || !user.organizationId) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ message: "ID inválido." }, { status: 400 });
    }

    await revokeToken(id, user.id, user.organizationId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao revogar token." }, { status: 500 });
  }
}
