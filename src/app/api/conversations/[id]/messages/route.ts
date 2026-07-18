import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { userOrgFilter } from "@/lib/auth-helpers";
import type { AppUserRole } from "@/lib/auth-types";
import {
  canDoChannelAction,
  requireChannelScope,
} from "@/lib/authz/resource-policy";
import { getContactWhatsAppTargets } from "@/lib/contact-whatsapp-target";
import { requireConversationAccess } from "@/lib/conversation-access";
import { resolveOutboundChannel } from "@/lib/outbound-channel";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { metaWhatsApp, metaClientFromConfig } from "@/lib/meta-whatsapp/client";
import { withRateLimit } from "@/lib/rate-limit";
import { sendWhatsAppText, isBaileysChannel } from "@/lib/send-whatsapp";
import {
  platformFromConversationChannel,
  sendMessengerOrInstagramText,
} from "@/lib/send-meta-messaging";
import { sseBus } from "@/lib/sse-bus";
import { getConversationLite, reopenResolvedAsNewTicket } from "@/services/conversations";
import { fireTrigger } from "@/services/automation-triggers";
import { cancelPendingForConversation } from "@/services/scheduled-messages";
import { logEvent } from "@/services/activity-log";

type RouteContext = { params: Promise<{ id: string }> };

// ── DTO ──────────────────────────────────────

/**
 * Entrada individual do JSON `Message.reactions`. Formato gravado pelo
 * webhook Meta em `applyIncomingReaction` (lib/meta-webhook/handler.ts):
 * um item por reator (WhatsApp permite 1 reação por pessoa em canais 1:1).
 *
 *   emoji: emoji cru (💚, 👍, …)
 *   from:  wa_id / BSUID de quem reagiu (contato)
 *   at:    ISO timestamp da reação mais recente
 */
export type ReactionDto = { emoji: string; from: string; at?: string };

export type InboxMessageDto = {
  id: number | string;
  content: string;
  createdAt: string | null;
  direction: "in" | "out" | "system";
  messageType: string | number | undefined;
  isPrivate?: boolean;
  senderName?: string | null;
  /**
   * Autoria explícita da mensagem (`human` | `bot` | `system`). Setado
   * pelos serviços que criam mensagens (automation-executor, AI handler,
   * whatsapp-flow-response). Usado pela UI para renderizar a badge
   * "AUTOMAÇÃO" independentemente do texto de `senderName` — antes a
   * detecção dependia de `senderName === "Automação"` hardcoded, o que
   * impedia mostrar o NOME da automação que executou o passo.
   */
  authorType?: "human" | "bot" | "system";
  /**
   * Nome do agente que disparou a automação MANUALMENTE. Quando presente
   * (mensagem `out` de bot), o inbox exibe o selo "Manual" + o avatar do
   * agente ao lado do robô (colab). NULL para envios automáticos/reativos.
   */
  triggeredByName?: string | null;
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
  /**
   * Status de entrega normalizado (estilo WhatsApp) — derivado de
   * `sendStatus`. Apenas mensagens `out` o exibem. Alimenta os ticks
   * (✓ / ✓✓ / ✓✓ azul) no balão do chat.
   */
  status?: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  /**
   * Conexão (Channel) por onde ESTA mensagem trafegou. Permite ao chat
   * distinguir, na mesma conversa, mensagens de contas distintas do mesmo
   * canal (ex.: dois WhatsApps da org). `null` = histórica/sem vínculo
   * (o frontend trata como "herda a conexão anterior", sem marcador).
   */
  channelId?: string | null;
  /** Mensagem favoritada pelo agente LOGADO (marcador pessoal — não é
   *  compartilhado entre agentes). Alimenta a estrela preenchida no
   *  menu contextual e no bubble. */
  favoritedByMe?: boolean;
};

/** Resumo de uma conexão (Channel) para exibir o canal na UI do inbox/contato. */
export type ConnectionRefDto = {
  id: string;
  name: string;
  type: string;
  phoneNumber: string | null;
};

/** Normaliza o `sendStatus` (string livre) para o enum de status do DTO. */
function mapSendStatus(s: string | null | undefined): InboxMessageDto["status"] {
  switch ((s ?? "").toLowerCase()) {
    case "pending":
      return "PENDING";
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "read":
      return "READ";
    case "failed":
      return "FAILED";
    default:
      return undefined; // "draft" e outros — sem ticks.
  }
}

// ── GET ──────────────────────────────────────

export async function GET(request: Request, context: RouteContext) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult.ok) return authResult.response;

    return await runWithApiUserContext(authResult.user, async () => {
    const { id } = await context.params;
    const accessUser = authResult.user as { id: string; role: AppUserRole };
    const denied = await requireConversationAccess({ user: accessUser }, id);
    if (denied) return denied;

    const conv = await getConversationLite(id);
    if (!conv) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }

    let pinnedNoteId: string | null = null;
    // Fixadas da conversa (banner estilo WhatsApp) — várias mensagens,
    // resolvidas para o id de bolha (`externalId ?? id`) que o frontend usa.
    let pinnedMessageIds: string[] = [];
    try {
      const convFull = await prisma.conversation.findUnique({
        where: { id: conv.id },
        select: { pinnedNoteId: true },
      });
      pinnedNoteId = convFull?.pinnedNoteId ?? null;

      const pins = await prisma.pinnedMessage.findMany({
        where: { conversationId: conv.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          expiresAt: true,
          message: { select: { id: true, externalId: true } },
        },
      });

      // Prazo vencido (24h/7d/30d) — desafixa sozinho na 1ª leitura pós-prazo,
      // sem cron dedicado. Remove as vencidas e mantém as válidas.
      const now = new Date();
      const expiredIds = pins.filter((p) => p.expiresAt && p.expiresAt < now).map((p) => p.id);
      if (expiredIds.length > 0) {
        await prisma.pinnedMessage.deleteMany({ where: { id: { in: expiredIds } } });
      }
      pinnedMessageIds = pins
        .filter((p) => !(p.expiresAt && p.expiresAt < now))
        .map((p) => p.message.externalId ?? p.message.id);
    } catch { /* tabela pode não existir ainda em ambientes antigos */ }

    // Janela de 24h e' do CONTATO (regra da Meta), nao do ticket. Com o
    // modelo de ticket, um ticket recem-criado (reopen/resposta) nasce sem
    // mensagens inbound — calcular so pelo ticket marcava a sessao como
    // fechada mesmo com o cliente ativo minutos antes no ticket anterior.
    // Busca o ultimo inbound em QUALQUER conversa do contato no canal.
    const lastInMsg = await prisma.message.findFirst({
      where: {
        direction: "in",
        conversation: conv.contactId
          ? { contactId: conv.contactId, channel: conv.channel }
          : { id: conv.id },
      },
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
    const includeHistory = url.searchParams.get("history") === "1" && !before;

    const MSG_SELECT = {
      id: true, externalId: true, content: true, createdAt: true,
      direction: true, messageType: true, isPrivate: true, senderName: true,
      authorType: true, triggeredByName: true,
      mediaUrl: true, replyToId: true, replyToPreview: true, reactions: true,
      sendStatus: true, sendError: true, channelId: true,
    } as const;

    const rows = await prisma.message.findMany({
      where: {
        conversationId: conv.id,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: MSG_SELECT,
    });

    rows.reverse();

    // Tickets anteriores do mesmo contato+canal (history=1, sem paginação).
    // Cada ticket RESOLVED recebe um separador visual antes das suas mensagens.
    type HistoryTicket = {
      id: string;
      number: number;
      closedAt: Date | null;
      rows: (typeof rows)[number][];
    };
    const historyTickets: HistoryTicket[] = [];
    if (includeHistory && conv.contactId && conv.channel) {
      const prevConvs = await prisma.conversation.findMany({
        where: {
          contactId: conv.contactId,
          channel: conv.channel,
          status: "RESOLVED",
          id: { not: conv.id },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, number: true, closedAt: true },
        take: 15,
      });
      for (const pc of prevConvs) {
        const pRows = await prisma.message.findMany({
          where: { conversationId: pc.id },
          orderBy: { createdAt: "asc" },
          take: 100,
          select: MSG_SELECT,
        });
        historyTickets.push({ id: pc.id, number: pc.number, closedAt: pc.closedAt, rows: pRows });
      }
    }

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

    // Favoritos do agente LOGADO nesta página de mensagens — uma query
    // agregada (IN) em vez de N+1. Escopo por userId: cada agente só vê
    // as próprias marcações.
    const favoritedIds = new Set<string>();
    try {
      const favRows = await prisma.favoriteMessage.findMany({
        where: {
          userId: (authResult.user as { id: string }).id,
          messageId: { in: rows.map((r) => r.id) },
        },
        select: { messageId: true },
      });
      for (const f of favRows) favoritedIds.add(f.messageId);
    } catch { /* tabela pode nao existir ainda em ambientes antigos */ }

    const senderAvatarMap = new Map<string, string | null>();
    if (outSenderNames.length > 0) {
      // Match cross-org seria leak (avatar de agente de outra org com mesmo
      // nome). Filtra pela org do caller via userOrgFilter — super-admin ve tudo.
      const agents = await prisma.user.findMany({
        where: {
          OR: outSenderNames.map((name) => ({
            name: { equals: name, mode: "insensitive" as const },
          })),
          ...userOrgFilter({ user: authResult.user }),
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
      authorType: r.authorType as "human" | "bot" | "system",
      triggeredByName: r.triggeredByName ?? undefined,
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
      status: r.direction === "out" ? mapSendStatus(r.sendStatus) : undefined,
      channelId: r.channelId ?? null,
      favoritedByMe: favoritedIds.has(r.id) || undefined,
    }));

    // Mapa de conexões referenciadas (canais das mensagens + canal atual da
    // conversa). Permite ao frontend rotular cada mensagem e o header com o
    // apelido + número da conexão sem N+1 queries no client.
    const referencedChannelIds = Array.from(
      new Set(
        [
          conv.channelId,
          ...rows.map((r) => r.channelId),
        ].filter((v): v is string => Boolean(v)),
      ),
    );
    const channelsMap: Record<string, ConnectionRefDto> = {};
    if (referencedChannelIds.length > 0) {
      const channelRows = await prisma.channel.findMany({
        where: {
          id: { in: referencedChannelIds },
          ...userOrgFilter({ user: authResult.user }),
        },
        select: { id: true, name: true, type: true, phoneNumber: true },
      });
      for (const ch of channelRows) {
        channelsMap[ch.id] = {
          id: ch.id,
          name: ch.name,
          type: ch.type,
          phoneNumber: ch.phoneNumber ?? null,
        };
      }
    }
    const currentChannel: ConnectionRefDto | null =
      (conv.channelId && channelsMap[conv.channelId]) || null;

    // Bloco C (25/jun/26): expõe `canReply` no payload pra o composer
    // entrar em modo leitura quando o usuário não tem `channel.send` no
    // canal. Derivado do mesmo enforcement do POST messages — fonte de
    // verdade é o backend; client usa só pra UX (desabilitar input + aviso).
    const canReply = await canDoChannelAction(accessUser, "send", conv.channelId);

    // Monta a linha do tempo completa: tickets anteriores (com separadores)
    // + mensagens do ticket atual.
    let finalMessages: InboxMessageDto[] = messages;
    if (historyTickets.length > 0) {
      const mapRows = (rr: typeof rows): InboxMessageDto[] =>
        rr.map((r) => ({
          id: r.externalId ?? r.id,
          content: r.content,
          createdAt: r.createdAt.toISOString(),
          direction: r.direction as InboxMessageDto["direction"],
          messageType: r.messageType,
          isPrivate: r.isPrivate || undefined,
          senderName: r.senderName,
          authorType: r.authorType as "human" | "bot" | "system",
          triggeredByName: r.triggeredByName ?? undefined,
          mediaUrl: r.mediaUrl,
          replyToId: r.replyToId,
          replyToPreview: r.replyToPreview,
          reactions: Array.isArray(r.reactions) ? (r.reactions as ReactionDto[]) : [],
          sendStatus: r.sendStatus,
          sendError: r.sendError ?? undefined,
          status: r.direction === "out" ? mapSendStatus(r.sendStatus) : undefined,
          channelId: r.channelId ?? null,
        }));

      const historical: InboxMessageDto[] = [];
      for (const ticket of historyTickets) {
        // Separador: um item "system" especial com os metadados do ticket.
        historical.push({
          id: `__ticket_sep_${ticket.id}`,
          content: JSON.stringify({
            number: ticket.number,
            closedAt: ticket.closedAt?.toISOString() ?? null,
          }),
          createdAt: null,
          direction: "system",
          messageType: "ticket-separator",
        });
        historical.push(...mapRows(ticket.rows));
      }
      // Separador do ticket atual (só se houver histórico).
      historical.push({
        id: `__ticket_sep_${conv.id}`,
        content: JSON.stringify({
          number: conv.number,
          closedAt: null,
          isCurrent: true,
        }),
        createdAt: null,
        direction: "system",
        messageType: "ticket-separator",
      });
      finalMessages = [...historical, ...messages];
    }

    return NextResponse.json({
      messages: finalMessages,
      pinnedNoteId,
      pinnedMessageIds,
      channelProvider: conv.channelRef?.provider ?? null,
      channel: currentChannel,
      channels: channelsMap,
      canReply,
      session: {
        lastInboundAt: lastInboundAt?.toISOString() ?? null,
        active: sessionActive,
        expiresAt: sessionExpiresAt,
      },
    });
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

    // Rate-limit por organização: 600 req/min/org. Cobre tanto API token
    // (integrações) quanto sessão de operador. Se um cliente quiser jogar
    // 1k msgs/min, usa /campaigns que fila por outro caminho.
    const userOrgId =
      (authResult.user as { organizationId?: string | null }).organizationId ?? null;
    const rl = await withRateLimit({
      route: "/api/conversations/:id/messages",
      profile: "api.default",
      scope: "org",
      id: userOrgId,
    });
    if (!rl.ok) return rl.response;

    return await runWithApiUserContext(authResult.user, async () => {
    const { id } = await context.params;
    const accessUser = authResult.user as { id: string; role: AppUserRole };
    const denied = await requireConversationAccess({ user: accessUser }, id);
    if (denied) return denied;

    let conv = await getConversationLite(id);
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

    // Regra "reabrir = novo id": responder numa conversa ENCERRADA reabre
    // como NOVO ticket. A mensagem entra no ticket novo; o id antigo fica
    // como historico. Notas internas NAO reabrem (sao anotacoes do ticket).
    let reopenedConversationId: string | null = null;
    if (!isPrivateNote && conv.status === "RESOLVED" && conv.contactId) {
      const reopened = await reopenResolvedAsNewTicket(conv.id);
      if (reopened.id !== conv.id) {
        const fresh = await getConversationLite(reopened.id);
        if (fresh) {
          reopenedConversationId = reopened.id;
          const previousConversationId = conv.id;
          if (reopened.created) {
            void logEvent({
              type: "CONVERSATION_CREATED",
              entityType: "CONVERSATION",
              entityId: fresh.id,
              entityLabel: null,
              conversationId: fresh.id,
              contactId: fresh.contactId,
              meta: { channel: fresh.channel, source: "reply_reopen", previousConversationId },
            });
            fireTrigger("conversation_created", {
              contactId: fresh.contactId ?? undefined,
              data: { channel: fresh.channel, source: "reply_reopen", previousConversationId },
            }).catch(() => { /* fire-and-forget */ });
          }
          conv = fresh;
        }
      }
    }

    // Override de canal vindo do composer (UI permite escolher por qual
    // WhatsApp enviar quando a org tem >1 conectado). Quando ausente ou
    // igual ao canal "atual" da conversa, comportamento legacy preservado.
    // Notas privadas ignoram override — são internas e não passam pelo canal.
    const requestedChannelId =
      typeof b.channelId === "string" ? b.channelId : null;

    // Escopo de canal: enviar mensagem exige permissão de "send" no canal
    // da conversa. Notas privadas são internas e não passam pelo canal.
    if (!isPrivateNote) {
      const sendDenied = await requireChannelScope(authResult.user, "send", conv.channelId);
      if (sendDenied) return sendDenied;
    }

    // Resolve o canal de envio (com override se válido). Vem ANTES do
    // `prisma.message.create` para que o snapshot `message.channelId` já
    // grave o canal certo.
    let outboundChannelRef = conv.channelRef;
    let outboundChannelId = conv.channelId;
    if (!isPrivateNote) {
      const resolved = await resolveOutboundChannel({
        conv: {
          channelId: conv.channelId,
          channelRef: conv.channelRef,
          organizationId: conv.organizationId,
        },
        user: authResult.user as {
          id: string;
          role?: string | null;
          organizationId: string | null;
          isSuperAdmin?: boolean;
        },
        requestedChannelId,
      });
      if (!resolved.ok) return resolved.response;
      outboundChannelRef = resolved.channelRef;
      outboundChannelId = resolved.channelId;
    }

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
        data: withOrgFromCtx({
          conversationId: conv.id,
          content,
          direction: "out",
          messageType: "note",
          isPrivate: true,
          senderName,
          replyToId: replyParentInternalId,
          replyToPreview,
        }),
      });

      // Activity Log: nota inserida pelo composer do Inbox. Antes deste
      // bloco o `return` abaixo curto-circuitava o `logEvent` que vem
      // depois (caminho de mensagem enviada), e a nota nao aparecia no
      // /logs. Resolvendo dealId via conversation->contact->open deal
      // para o feed conseguir filtrar pelo deal correspondente.
      void (async () => {
        const openDeal = conv.contactId
          ? await prisma.deal.findFirst({
              where: { contactId: conv.contactId, status: "OPEN" },
              select: { id: true },
              orderBy: { updatedAt: "desc" },
            }).catch(() => null)
          : null;

        // Persistir também na tabela `Note` — assim a nota escrita no chat
        // aparece no "histórico de notas" (aba Notas do deal/contato), que
        // lê `Note`, não `Message`. Sem isto a nota só existia como mensagem
        // interna e ficava invisível fora da conversa. Criamos direto via
        // prisma (sem createDealEvent) pra não duplicar o NOTE_ADDED que já
        // é logado logo abaixo.
        if (conv.contactId || openDeal?.id) {
          await prisma.note
            .create({
              data: withOrgFromCtx({
                content,
                contactId: conv.contactId ?? undefined,
                dealId: openDeal?.id ?? undefined,
                userId: authResult.user.id,
              }),
            })
            .catch(() => null);
        }

        await logEvent({
          type: "NOTE_ADDED",
          entityType: "MESSAGE",
          entityId: saved.id,
          entityLabel: senderName ?? "Nota interna",
          conversationId: conv.id,
          contactId: conv.contactId,
          dealId: openDeal?.id ?? null,
          meta: {
            preview: content.slice(0, 200),
            source: "inbox_composer",
            isPrivate: true,
          },
        });
      })();

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

    // ── Send via Facebook Messenger / Instagram Direct ──
    // Branch antes do fluxo WhatsApp: canais IG/FB tem identificadores
    // (PSID/IGSID) e endpoints distintos e nao passam pelo getContactWhatsAppTargets.
    const messagingPlatform = platformFromConversationChannel(conv.channel);
    if (messagingPlatform) {
      const savedMsg = await prisma.message.create({
        data: withOrgFromCtx({
          conversationId: conv.id,
          channelId: outboundChannelId ?? undefined,
          content,
          direction: "out",
          messageType: "text",
          senderName,
          replyToId: replyParentInternalId,
          replyToPreview,
        }),
      });

      const sendRes = await sendMessengerOrInstagramText({
        conversationId: conv.id,
        contactId: conv.contactId,
        channelRef: outboundChannelRef
          ? { id: outboundChannelRef.id, config: outboundChannelRef.config }
          : null,
        content,
        messageId: savedMsg.id,
        platform: messagingPlatform,
      });

      const channelLabel =
        messagingPlatform === "instagram" ? "Instagram" : "Messenger";

      try {
        await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            lastMessageDirection: "out",
            hasAgentReply: true,
            ...(sendRes.failed ? { hasError: true } : { hasError: false }),
          },
        });
      } catch { /* colunas opcionais */ }

      fireTrigger("message_sent", {
        contactId: conv.contactId,
        data: { channel: channelLabel, content },
      }).catch((err) => console.warn("[automation trigger] message_sent:", err));

      if (!sendRes.failed) {
        void logEvent({
          type: "MESSAGE_SENT",
          entityType: "MESSAGE",
          entityId: savedMsg.id,
          entityLabel: senderName ?? "Mensagem enviada",
          conversationId: conv.id,
          contactId: conv.contactId,
          meta: {
            preview: content.slice(0, 200),
            channel: channelLabel,
            via: "meta_messaging",
            externalId: sendRes.externalId,
          },
        });
      }

      try {
        sseBus.publish("new_message", {
          organizationId: conv.organizationId,
          conversationId: conv.id,
          contactId: conv.contactId,
          direction: "out",
          content,
          timestamp: savedMsg.createdAt,
        });
      } catch { /* best-effort */ }

      cancelPendingForConversation(conv.id, "agent_reply", authResult.user.id).catch(
        (err) =>
          console.warn(
            "[scheduled-messages] falha ao cancelar apos envio manual:",
            err,
          ),
      );

      return NextResponse.json(
        {
          message: {
            id: sendRes.externalId ?? savedMsg.id,
            content,
            createdAt: savedMsg.createdAt.toISOString(),
            direction: "out",
            messageType: "text",
            senderName,
            replyToId: replyParentInternalId,
            replyToPreview,
            status: sendRes.error ? "FAILED" : "SENT",
            channelId: outboundChannelId ?? null,
          } satisfies InboxMessageDto,
          conversationId: conv.id,
          ...(reopenedConversationId ? { reopenedConversationId } : {}),
          ...(sendRes.error ? { metaError: sendRes.error } : {}),
        },
        { status: 201 },
      );
    }

    // ── Send via WhatsApp (Meta Cloud API or Baileys) ──

    const useBaileys = isBaileysChannel(outboundChannelRef);

    const channelConfig = outboundChannelRef?.config as Record<string, unknown> | null | undefined;
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
      data: withOrgFromCtx({
        conversationId: conv.id,
        channelId: outboundChannelId ?? undefined,
        content,
        direction: "out",
        messageType: "text",
        senderName,
        replyToId: replyParentInternalId,
        replyToPreview,
        ...(localOnly ? { sendStatus: "sent" } : {}),
      }),
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
          channelRef: outboundChannelRef,
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

    // Log unificado de atividade (Activity Log) — fire-and-forget.
    // Falhas de envio sao registradas como MESSAGE_FAILED dentro de
    // sendWhatsAppText (markFailed) — aqui so logamos o sucesso para
    // nao duplicar o evento nem poluir as estatisticas.
    if (!sendFailed) {
      void logEvent({
        type: "MESSAGE_SENT",
        entityType: "MESSAGE",
        entityId: saved.id,
        entityLabel: senderName ?? "Mensagem enviada",
        conversationId: conv.id,
        contactId: conv.contactId,
        meta: {
          preview: content.slice(0, 200),
          channel: "WhatsApp",
          via: useBaileys ? "baileys" : localOnly ? "local" : "meta",
          externalId,
        },
      });
    }

    // Notifica abas/inboxes em tempo real: a conversa acabou de mudar de
    // 'esperando' para 'respondidas' (ou similar). Sem isso, a UI so
    // atualizava no proximo polling (15-20s) — usuario percebia delay.
    try {
      sseBus.publish("new_message", {
        organizationId: conv.organizationId,
        conversationId: conv.id,
        contactId: conv.contactId,
        direction: "out",
        content,
        timestamp: saved.createdAt,
      });
    } catch {
      // best-effort: nunca derruba o envio por falha de SSE.
    }

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
        status: sendErrorMsg ? "FAILED" : "SENT",
        channelId: outboundChannelId ?? null,
      } satisfies InboxMessageDto,
      conversationId: conv.id,
      ...(reopenedConversationId ? { reopenedConversationId } : {}),
      ...(sendErrorMsg ? { metaError: sendErrorMsg } : {}),
    }, { status: 201 });
    });
  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Erro ao enviar mensagem.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
