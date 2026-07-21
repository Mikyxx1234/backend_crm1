import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { toggleAIAgentActive } from "@/services/ai-agents";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await requireAuth();
  if (!r.ok) return r.response;
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
