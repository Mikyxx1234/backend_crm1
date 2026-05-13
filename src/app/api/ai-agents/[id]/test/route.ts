import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { runAgent } from "@/services/ai/runner";

/**
 * Playground de teste — chama o runner sem atrelar a nenhuma conversa
 * real. Útil para o admin validar o prompt/tools do agente antes de
 * ativar no inbox. Suporta passar contactId/dealId opcionais para
 * simular um contexto real.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  const userMessage =
    typeof body.message === "string" ? body.message.trim() : "";
  if (!userMessage) {
    return NextResponse.json(
      { message: "Mensagem vazia." },
      { status: 400 },
    );
  }

  const contactId =
    typeof body.contactId === "string" && body.contactId ? body.contactId : null;
  const dealId =
    typeof body.dealId === "string" && body.dealId ? body.dealId : null;
  const history = Array.isArray(body.history)
    ? (body.history as Array<{ role: "user" | "assistant"; content: string }>)
        .filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string",
        )
        .slice(-10)
    : undefined;

  try {
    const result = await runAgent({
      agentId: id,
      source: "playground",
      userMessage,
      contactId,
      dealId,
      history,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
