import { NextResponse } from "next/server";

import type { AppUserRole } from "@/lib/auth-types";

type SessionLike = { user?: { id?: string; role?: AppUserRole } } | null;

/** Importação em massa: apenas ADMIN e MANAGER. */
export function assertImportPermission(session: SessionLike): NextResponse | null {
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== "ADMIN" && role !== "MANAGER") {
    return NextResponse.json(
      { message: "Apenas administradores e gerentes podem importar dados." },
      { status: 403 },
    );
  }
  return null;
}
