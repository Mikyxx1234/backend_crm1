import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const r = await requireAuth();
  if (!r.ok) return r.response;
  const { id, docId } = await params;

  const doc = await prisma.aIAgentKnowledgeDoc.findFirst({
    where: { id: docId, agentId: id },
    select: { id: true },
  });
  if (!doc) {
    return NextResponse.json(
      { message: "Documento não encontrado." },
      { status: 404 },
    );
  }

  // A cascata onDelete remove os chunks e seus embeddings.
  await prisma.aIAgentKnowledgeDoc.delete({ where: { id: docId } });
  return NextResponse.json({ ok: true });
}
