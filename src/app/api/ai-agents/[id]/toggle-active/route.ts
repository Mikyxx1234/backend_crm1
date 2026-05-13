import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { toggleAIAgentActive } from "@/services/ai-agents";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }
  const { id } = await params;
  try {
    const updated = await toggleAIAgentActive(id);
    return NextResponse.json({ active: updated.active });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro.";
    const status = msg.includes("não encontrado") ? 404 : 500;
    return NextResponse.json({ message: msg }, { status });
  }
}
