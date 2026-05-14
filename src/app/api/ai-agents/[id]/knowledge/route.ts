import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { scheduleIndexing } from "@/services/ai/embeddings";

/**
 * GET — lista documentos de conhecimento do agente.
 * POST — cria novo doc a partir de texto colado e dispara indexação.
 *
 * Arquivos binários (PDF/DOCX) ficam para uma subfase: por ora
 * aceitamos apenas `{ title, content }` em JSON, que cobre a maior
 * parte dos playbooks, FAQs e roteiros que os usuários já têm em md/doc.
 */

// Bug 27/abr/26: usavamos `auth()` direto. A rota chama `withOrgFromCtx`
// (direto ou via service), avaliado ANTES da Prisma extension popular
// o ctx. Migrado para withOrgContext.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgContext(async () => {
    const { id } = await params;

    const docs = await prisma.aIAgentKnowledgeDoc.findMany({
      where: { agentId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        source: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        errorMessage: true,
        chunkCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json(docs);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgContext(async () => {
    const { id } = await params;

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const title =
      typeof body.title === "string" ? body.title.trim() : "";
    const content =
      typeof body.content === "string" ? body.content.trim() : "";
    if (!title || !content) {
      return NextResponse.json(
        { message: "Informe título e conteúdo." },
        { status: 400 },
      );
    }
    if (content.length > 500_000) {
      return NextResponse.json(
        { message: "Conteúdo muito grande (limite 500k caracteres nesta versão)." },
        { status: 400 },
      );
    }

    const agent = await prisma.aIAgentConfig.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!agent) {
      return NextResponse.json(
        { message: "Agente não encontrado." },
        { status: 404 },
      );
    }

    const doc = await prisma.aIAgentKnowledgeDoc.create({
      data: withOrgFromCtx({
        agentId: id,
        title,
        source: "paste",
        mimeType: "text/plain",
        sizeBytes: Buffer.byteLength(content, "utf8"),
        status: "PENDING" as const,
      }),
    });

    scheduleIndexing(doc.id, content);

    return NextResponse.json(doc, { status: 201 });
  });
}
