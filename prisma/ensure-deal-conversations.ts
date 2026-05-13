/**
 * ensure-deal-conversations.ts
 * ────────────────────────────
 * Garante que TODO deal do banco esteja conectado ao Chat com histórico
 * minimamente plausível. Idempotente — pode rodar quantas vezes quiser.
 *
 * Regras (espelham produção):
 *   1. Todo deal precisa ter `contactId` (skip + warn caso contrário).
 *   2. Todo contato com deal precisa ter pelo menos 1 conversation.
 *      - Se não tem nenhuma → cria stub OPEN/whatsapp.
 *      - Se já tem → usa a mais recente (não duplica).
 *   3. Toda conversation associada a deal precisa ter ≥ 2 mensagens.
 *      - Se está vazia → popula 2 a 3 mensagens fictícias coerentes com
 *        o nome do contato + título do deal.
 *
 * Não toca em conversas que já têm mensagens. Não cria deals/contacts.
 *
 * Uso:
 *   npx tsx prisma/ensure-deal-conversations.ts
 *   # ou via package.json: npm run db:ensure-conversations
 *
 * Também é exportado como função (`ensureAllDealsHaveConversations`) e
 * chamado no final do `seed-sales-hub.ts` para garantir que rodar o seed
 * sempre deixe o banco em estado consistente (nenhum deal órfão de chat).
 */

import { PrismaClient } from "@prisma/client";

const ENSURE_PREFIX = "ensure-conv-";

function minutesAgo(min: number): Date {
  return new Date(Date.now() - min * 60_000);
}

function firstName(full: string): string {
  return (full.split(" ")[0] || "").trim() || "cliente";
}

/**
 * Templates randomizados — geram 2-3 mensagens curtas (1 inbound + 1 outbound,
 * ocasionalmente uma terceira inbound). Todas com timestamps decrescentes
 * pra simular linha do tempo real.
 */
function buildMessages(args: {
  contactName: string;
  dealTitle: string;
}): Array<{ content: string; direction: "in" | "out"; minsAgo: number }> {
  const fname = firstName(args.contactName);
  const subject =
    args.dealTitle
      .replace(/^(SITE|Site|Lead\s*[-—:]?\s*)/i, "")
      .trim() || args.dealTitle;

  const inboundOpeners = [
    `Oi! Tenho interesse em ${subject}. Pode me passar mais informações?`,
    `Olá, vi o anúncio de vocês e queria entender melhor sobre ${subject}.`,
    `Bom dia! Como funciona o ${subject}? Qual o valor?`,
    `Oi, gostaria de saber mais sobre ${subject}.`,
    `Olá! Estou pesquisando sobre ${subject}, vocês têm material pra me enviar?`,
  ];

  const outboundReplies = [
    `Olá ${fname}! Obrigado pelo contato 👋 Vou te passar todas as informações sobre ${subject} agora mesmo.`,
    `Oi ${fname}, tudo bem? Que bom que você se interessou por ${subject}. Posso te ligar pra explicar com calma?`,
    `${fname}, recebi sua mensagem! Vou montar uma proposta personalizada e te envio em seguida.`,
    `Bom dia ${fname}! Obrigado pelo interesse. ${subject} é nosso produto principal — posso te enviar o material completo?`,
  ];

  const inboundFollowUps = [
    `Perfeito, fico no aguardo!`,
    `Ótimo, pode me chamar no WhatsApp.`,
    `Show, obrigado pelo retorno rápido!`,
    `Beleza, aguardo o material.`,
  ];

  // Escolha pseudo-aleatória estável por deal (hash simples do título).
  let seed = 0;
  for (const c of args.dealTitle) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const pick = <T,>(arr: T[]) => arr[seed++ % arr.length];

  const includeFollowUp = seed % 3 !== 0; // ~66% têm 3 mensagens.

  const msgs: Array<{ content: string; direction: "in" | "out"; minsAgo: number }> = [
    { content: pick(inboundOpeners), direction: "in", minsAgo: 180 },
    { content: pick(outboundReplies), direction: "out", minsAgo: 120 },
  ];
  if (includeFollowUp) {
    msgs.push({ content: pick(inboundFollowUps), direction: "in", minsAgo: 30 });
  }
  return msgs;
}

export type EnsureSummary = {
  dealsProcessed: number;
  dealsSkippedNoContact: number;
  conversationsCreated: number;
  messagesCreated: number;
};

/**
 * Função pura — recebe um PrismaClient (pra evitar criar várias conexões
 * quando chamada a partir do seed). Retorna métricas pra logging.
 */
export async function ensureAllDealsHaveConversations(
  prisma: PrismaClient,
  opts: { verbose?: boolean } = {},
): Promise<EnsureSummary> {
  const verbose = opts.verbose ?? true;

  const deals = await prisma.deal.findMany({
    select: {
      id: true,
      title: true,
      contactId: true,
      ownerId: true,
      contact: {
        select: {
          id: true,
          name: true,
          conversations: {
            select: {
              id: true,
              status: true,
              externalId: true,
              channel: true,
              _count: { select: { messages: true } },
            },
            orderBy: { updatedAt: "desc" },
          },
        },
      },
    },
  });

  let dealsSkippedNoContact = 0;
  let conversationsCreated = 0;
  let messagesCreated = 0;

  // Memoriza contactId já tratado nesta execução — evita reprocessar
  // quando o mesmo contato tem múltiplos deals.
  const handledContact = new Set<string>();

  for (const deal of deals) {
    if (!deal.contactId || !deal.contact) {
      dealsSkippedNoContact++;
      continue;
    }
    if (handledContact.has(deal.contactId)) continue;
    handledContact.add(deal.contactId);

    let conv = deal.contact.conversations[0]; // mais recente

    if (!conv) {
      const created = await prisma.conversation.create({
        data: {
          externalId: `${ENSURE_PREFIX}${deal.contactId}`,
          channel: "whatsapp",
          status: "OPEN",
          contactId: deal.contactId,
          assignedToId: deal.ownerId ?? null,
          unreadCount: 0,
          hasAgentReply: false,
        },
      });
      conv = {
        id: created.id,
        status: created.status,
        externalId: created.externalId,
        channel: created.channel,
        _count: { messages: 0 },
      };
      conversationsCreated++;
      if (verbose)
        console.log(
          `  ➕ Conversa criada para "${deal.contact.name}" (deal: ${deal.title})`,
        );
    }

    if (conv._count.messages === 0) {
      const msgs = buildMessages({
        contactName: deal.contact.name,
        dealTitle: deal.title,
      });
      // Mais antiga primeiro pra createdAt ficar coerente.
      const sorted = [...msgs].sort((a, b) => b.minsAgo - a.minsAgo);

      let lastInbound: Date | null = null;
      let hasAgentReply = false;
      let lastMessageDirection: "in" | "out" | null = null;

      for (const m of sorted) {
        await prisma.message.create({
          data: {
            conversationId: conv.id,
            content: m.content,
            direction: m.direction,
            messageType: "text",
            authorType: "human",
            isPrivate: false,
            sendStatus: m.direction === "out" ? "delivered" : "sent",
            createdAt: minutesAgo(m.minsAgo),
          },
        });
        messagesCreated++;
        if (m.direction === "in") lastInbound = minutesAgo(m.minsAgo);
        if (m.direction === "out") hasAgentReply = true;
        lastMessageDirection = m.direction;
      }

      // Não mexe em status/closedAt — preserva o que já estava lá.
      // Regra de produto: encerrar conversa não move deal de etapa, e
      // popular histórico tampouco deve "reabrir" uma conversa RESOLVED.
      await prisma.conversation.update({
        where: { id: conv.id },
        data: {
          lastInboundAt: lastInbound,
          hasAgentReply,
          lastMessageDirection,
        },
      });

      if (verbose)
        console.log(
          `  💬 ${msgs.length} mensagens populadas para "${deal.contact.name}"`,
        );
    }
  }

  return {
    dealsProcessed: deals.length,
    dealsSkippedNoContact,
    conversationsCreated,
    messagesCreated,
  };
}

// ─── CLI standalone ───────────────────────────────────────────────────
// Só executa se rodado diretamente (não quando importado pelo seed).
const isMain = (() => {
  try {
    // tsx/node: process.argv[1] resolve para o arquivo que iniciou o processo.
    const entry = process.argv[1] ?? "";
    return entry.includes("ensure-deal-conversations");
  } catch {
    return false;
  }
})();

if (isMain) {
  const prisma = new PrismaClient();
  console.log("🔌 Conectando ao banco…");
  ensureAllDealsHaveConversations(prisma)
    .then((s) => {
      console.log("");
      console.log("═══════════════════════════════════════");
      console.log(`  Deals processados            : ${s.dealsProcessed}`);
      console.log(`  Deals sem contato (skip)     : ${s.dealsSkippedNoContact}`);
      console.log(`  Conversas criadas            : ${s.conversationsCreated}`);
      console.log(`  Mensagens criadas            : ${s.messagesCreated}`);
      console.log("═══════════════════════════════════════");
      console.log("✅ Todos os deals agora têm conversa com histórico.");
    })
    .catch((e) => {
      console.error("✗ Erro ao garantir conversas:", e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
