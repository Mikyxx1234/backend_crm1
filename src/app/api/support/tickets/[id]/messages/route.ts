import { NextResponse } from "next/server";
import { z } from "zod";

import { withOrgContext } from "@/lib/auth-helpers";
import {
  getTicketForViewer,
  listMessages,
  markRead,
  sendMessage,
  type SupportViewer,
} from "@/services/support/tickets";

const SendSchema = z.object({ content: z.string().min(1).max(4000) });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgContext(async (session) => {
    const { id } = await params;
    const viewer: SupportViewer = {
      userId: session.user.id,
      organizationId: session.user.organizationId!,
      role: session.user.role ?? null,
    };
    const res = await getTicketForViewer(viewer, id);
    if (!res.ok) {
      return NextResponse.json(
        { message: res.code === 404 ? "Ticket não encontrado." : "Acesso negado." },
        { status: res.code },
      );
    }
    // Marcar como lido para a ponta que abriu.
    await markRead(viewer, id, res.isAgent && !res.isRequester);
    const messages = await listMessages(id);
    return NextResponse.json(messages);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgContext(async (session) => {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = SendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: "Mensagem inválida." }, { status: 400 });
    }
    const viewer: SupportViewer = {
      userId: session.user.id,
      organizationId: session.user.organizationId!,
      role: session.user.role ?? null,
    };
    const res = await getTicketForViewer(viewer, id);
    if (!res.ok) {
      return NextResponse.json(
        { message: res.code === 404 ? "Ticket não encontrado." : "Acesso negado." },
        { status: res.code },
      );
    }
    // Envia como agente quando o viewer NÃO é o solicitante (é o atendente).
    const asAgent = res.isAgent && !res.isRequester;
    const message = await sendMessage(viewer, id, parsed.data.content, asAgent);
    return NextResponse.json(message, { status: 201 });
  });
}
