import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }
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
