import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getContactTimeline } from "@/services/contacts";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }
    const { id } = await context.params;
    const timeline = await getContactTimeline(id);
    return NextResponse.json(timeline);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao carregar timeline." }, { status: 500 });
  }
}
