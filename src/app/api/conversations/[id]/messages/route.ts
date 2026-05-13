import { NextResponse } from "next/server";

import { authenticateApiRequest } from "@/lib/api-auth";
import type { AppUserRole } from "@/lib/auth-types";
import { getContactWhatsAppTargets } from "@/lib/contact-whatsapp-target";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";
import { metaWhatsApp, metaClientFromConfig } from "@/lib/meta-whatsapp/client";
import { sendWhatsAppText, isBaileysChannel } from "@/lib/send-whatsapp";
import { getConversationLite } from "@/services/conversations";
import { fireTrigger } from "@/services/automation-triggers";
import { cancelPendingForConversation } from "@/services/scheduled-messages";

type RouteContext = { params: Promise<{ id: string }> };

// ── DTO ──────────────────────────────────────

export type ReactionDto = { emoji: string; senderName: string };

export type InboxMessageDto = {
  id: number | string;
  content: string;
  createdAt: string | null;
  direction: "in" | "out" | "system";
  messageType: string | number | undefined;
  isPrivate?: boolean;
  senderName?: string | null;
  /**
   * URL da foto de perfil do agente que assinou a mensagem (resolvido
   * server-side via match de `senderName` com `User.name` no workspace).
   * Permite que o avatar exibido no balão out (chat-window) HERDE a
   * mesma identidade visual do perfil do usuário em `/settings/profile`,
   * sem depender de FK direta — `Message.senderId` ainda não existe no
   * schema; quando existir, troca esse lookup por relação direta.
   */
  senderImageUrl?: string | null;
  mediaUrl?: string | null;
  replyToId?: string | null;
  replyToPreview?: string | null;
  reactions?: ReactionDto[];
  sendStatus?: string;
  sendError?: string;
};

// ── GET ──────────────────────────────────────

export async function GET(request: Request, context: RouteContext) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    const { id } = await context.params;
    const accessUser = authResult.user as { id: string; role: AppUserRole };
    const denied = await requireConversationAccess({ user: accessUser }, id);
    if (denied) return denied;

    const conv = await getConversationLite(id);
    if (!conv) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }

    let pinnedNoteId: string | null = null;
    try {
      const convFull = await prisma.conversation.findUnique({
        where: { id: conv.id },
        select: { pinnedNoteId: true },
      });
      pinnedNoteId = convFull?.pinnedNoteId ?? null;
    } catch { /* column may not exist */ }

    const lastInMsg = await prisma.message.findFirst({
      where: { conversationId: conv.id, direction: "in" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const lastInboundAt = lastInMsg?.createdAt ?? null;

    const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const diffMs = lastInboundAt ? now - lastInboundAt.getTime() : null;
    const sessionActive = diffMs !== null ? diffMs < SESSION_WINDOW_MS : false;
    const sessionExpiresAt = lastInboundAt
      ? new Date(lastInboundAt.getTime() + SESSION_WINDOW_MS).toISOString()
      : null;

    console.log(
      `[session] conv=${conv.id} lastInbound=${lastInboundAt?.toISOString() ?? "NULL"} diffH=${diffMs !== null ? (diffMs / 3_600_000).toFixed(2) : "N/A"} active=${sessionActive}`
    );

    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const before = url.searchParams.get("before");

    const rows = await prisma.message.findMany({
      where: {
        conversationId: conv.id,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true, externalId: true, content: true, createdAt: true,
        direction: true, messageType: true, isPrivate: true, senderName: true,
        mediaUrl: true, replyToId: true, replyToPreview: true, reactions: true,
        sendStatus: true, sendError: true,
      },
    });

    rows.reverse();

    // Resolve foto de perfil dos agentes que assinaram cada mensagem
    // outbound. Sem FK `Message.senderId` no schema atual, a única
    // chave que o Prisma persiste é o `senderName` (string). Buscamos
    // todos os Users do workspace cujos nomes aparecem como sender em
    // alguma mensagem out — UMA query agregada, depois indexamos no
    // map abaixo. Match é case-insensitive pra resistir a variações
    // mínimas de cadastro ("Marcelo Pinheiro" vs "Marcelo pinheiro").
    const outSenderNames = Array.from(
      new Set(
        rows
          .filter((r) => r.direction === "out" && r.senderName)
          .map((r) => r.senderName!.trim())
          .filter(Boolean),
      ),
    );

    const senderAvatarMap = new Map<string, string | null>();
    if (outSenderNames.length > 0) {
      const agents = await prisma.user.findMany({
        where: {
          OR: outSenderNames.map((name) => ({
            name: { equals: name, mode: "insensitive" as const },
          })),
        },
        select: { name: true, avatarUrl: true },
      });
      for (const agent of agents) {
        senderAvatarMap.set(agent.name.toLowerCase(), agent.avatarUrl ?? null);
      }
    }

    const messages: InboxMessageDto[] = rows.map((r) => ({
      id: r.externalId ?? r.id,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
      direction: r.direction as InboxMessageDto["direction"],
      messageType: r.messageType,
      isPrivate: r.isPrivate || undefined,
      senderName: r.senderName,
      senderImageUrl:
        r.direction === "out" && r.senderName
          ? senderAvatarMap.get(r.senderName.trim().toLowerCase()) ?? null
          : null,
      mediaUrl: r.mediaUrl,
      replyToId: r.replyToId,
      replyToPreview: r.replyToPreview,
      reactions: Array.isArray(r.reactions) ? (r.reactions as ReactionDto[]) : [],
      sendStatus: r.sendStatus,
      sendError: r.sendError ?? undefined,
    }));

    return NextResponse.json({
      messages,
      pinnedNoteId,
      channelProvider: conv.channelRef?.provider ?? null,
      session: {
        lastInboundAt: lastInboundAt?.toISOString() ?? null,
        active: sessionActive,
        expiresAt: sessionExpiresAt,
      },
    });
  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Erro ao carregar mensagens.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}

// ── POST ─────────────────────────────────────

export async function POST(request: Request, context: RouteContext) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    const { id } = await context.params;
    const accessUser = authResult.user as { id: string; role: AppUserRole };
    const denied = await requireConversationAccess({ user: accessUser }, id);
    if (denied) return denied;

    const conv = await getConversationLite(id);
    if (!conv) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const content = typeof b.content === "string" ? b.content.trim() : "";
    if (!content) {
      return NextResponse.json({ message: "Mensagem vazia." }, { status: 400 });
    }

    const messageType =
      typeof b.messageType === "string" && b.messageType.length > 0
        ? b.messageType
        : "outgoing";
    const isPrivateNote = b.private === true || messageType === "note";
    const senderName = authResult.user.name ?? authResult.user.email ?? "Agente";
    const replyRef = typeof b.replyToId === "string" ? b.replyToId.trim() : "";

    let replyToPreview: string | null = null;
    let replyParentInternalId: string | null = null;
    let replyContextWamid: string | null = null;
    if (replyRef) {
      const parent = await prisma.message.findFirst({
        where: {
          conversationId: conv.id,
          OR: [{ id: replyRef }, { externalId: replyRef }],
        },
        select: { id: true, content: true, externalId: true },
      });
      if (parent) {
        replyParentInternalId = parent.id;
        replyContextWamid = parent.externalId?.trim() || null;
        replyToPreview = parent.content.length > 120
          ? parent.content.slice(0, 117) + "…"
          : parent.content;
      }
    }

    if (isPrivateNote) {
      const saved = await prisma.message.create({
        data: {
          conversationId: conv.id,
          content,
          direction: "out",
          messageType: "note",
          isPrivate: true,
          senderName,
          replyToId: replyParentInternalId,
          replyToPreview,
        },
      });

      return NextResponse.json({
        message: {
          id: saved.id,
          content,
          createdAt: saved.createdAt.toISOString(),
          direction: "out",
          messageType: "note",
          isPrivate: true,
          senderName,
        } satisfies InboxMessageDto,
      }, { status: 201 });
    }

    // ── Send via WhatsApp (Meta Cloud API or Baileys) ──

    const useBaileys = isBaileysChannel(conv.channelRef);

    const channelConfig = conv.channelRef?.config as Record<string, unknown> | null | undefined;
    const metaClient = useBaileys ? metaWhatsApp : metaClientFromConfig(channelConfig);

    // Modo "local/test": sem canal WhatsApp configurado (conversas mock ou
    // ambiente de desenvolvimento sem Meta/Baileys). Ainda persistimos a
    // mensagem no banco para que o chat funcione localmente; apenas pulamos
    // o envio externo e avisamos via metaError.
    const localOnly = !useBaileys && !metaClient.configured;

    if (!useBaileys && !localOnly) {
      const waTarget = await getContactWhatsAppTargets(conv.contactId);
      if (!waTarget) {
        return NextResponse.json(
          { message: "Contato sem telefone nem BSUID WhatsApp (Meta)." },
          { status: 400 }
        );
      }
    }

    const saved = await prisma.message.create({
      data: {
        conversationId: conv.id,
        content,
        direction: "out",
        messageType: "text",
        senderName,
        replyToId: replyParentInternalId,
        replyToPreview,
        ...(localOnly ? { sendStatus: "sent" } : {}),
      },
    });

    if (!useBaileys && !localOnly) {
      const lastInbound = await prisma.message.findFirst({
        where: { conversationId: conv.id, direction: "in", externalId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { externalId: true },
      });
      if (lastInbound?.externalId) {
        metaClient.sendTypingIndicator(lastInbound.externalId).catch(() => {});
      }
    }

    const sendResult = localOnly
      ? { externalId: null as string | null, failed: false, error: undefined as string | undefined }
      : await sendWhatsAppText({
          conversationId: conv.id,
          contactId: conv.contactId,
          channelRef: conv.channelRef,
          content,
          messageId: saved.id,
          replyContextWamid,
          waJid: conv.waJid,
        });

    const externalId = sendResult.externalId;
    const sendFailed = sendResult.failed;
    const sendErrorMsg = sendResult.error;

    // Update conversation tracking fields
    try {
      await prisma.conversation.update({
        where: { id: conv.id },
        data: {
          lastMessageDirection: "out",
          hasAgentReply: true,
          ...(sendFailed ? { hasError: true } : { hasError: false }),
        },
      });
    } catch { /* columns may not exist yet */ }

    fireTrigger("message_sent", {
      contactId: conv.contactId,
      data: { channel: "WhatsApp", content },
    }).catch((err) => console.warn("[automation trigger] message_sent:", err));

    // Agente enviou mensagem manual: cancela qualquer agendamento pendente
    // da conversa (convenção do "qualquer interação cancela"). Uso
    // cancelledById=null porque o cancelamento é automático, não manual.
    cancelPendingForConversation(conv.id, "agent_reply", authResult.user.id).catch(
      (err) =>
        console.warn(
          "[scheduled-messages] falha ao cancelar apos envio manual:",
          err,
        ),
    );

    return NextResponse.json({
      message: {
        id: externalId ?? saved.id,
        content,
        createdAt: saved.createdAt.toISOString(),
        direction: "out",
        messageType: "text",
        senderName,
        replyToId: replyParentInternalId,
        replyToPreview,
      } satisfies InboxMessageDto,
      ...(sendErrorMsg ? { metaError: sendErrorMsg } : {}),
    }, { status: 201 });
  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Erro ao enviar mensagem.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
