/**
 * merge-duplicate-conversations
 *
 * Consolida conversas ATIVAS duplicadas do mesmo contato+canal num unico
 * ticket. Ate a correcao de 16/jul/26, uma condicao de corrida (mensagens
 * inbound simultaneas / retries de webhook) podia disparar varios
 * `findOrCreateConversation` ao mesmo tempo — cada um criava um ticket OPEN,
 * gerando 2-3 cards ativos do mesmo numero. O modelo de ticket continua
 * valido: conversas RESOLVED sao historico e NAO sao tocadas.
 *
 * Estrategia por grupo (organizationId + contactId + channel), considerando
 * apenas conversas com status != RESOLVED:
 *  - Canonica = ticket ativo mais ANTIGO (menor createdAt).
 *  - Move mensagens e registros relacionados dos ativos duplicados para a
 *    canonica.
 *  - Apaga os ativos duplicados (ja vazios).
 *  - Recalcula agregados da canonica (lastInboundAt, direcao, unread).
 *
 * Rode ANTES de aplicar a migration `conversations_active_contact_channel`
 * (o indice unico parcial exige no maximo 1 ticket ativo por contato+canal).
 *
 * Uso:
 *   pnpm tsx src/scripts/merge-duplicate-conversations.ts           # dry-run
 *   pnpm tsx src/scripts/merge-duplicate-conversations.ts --apply   # aplica
 *
 * Idempotente: apos rodar, cada contato+canal tem no maximo 1 ticket ativo.
 */

import type { ConversationStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type ConvRow = {
  id: string;
  number: number;
  status: ConversationStatus;
  createdAt: Date;
  updatedAt: Date;
  unreadCount: number;
};

async function main() {
  const apply = process.argv.includes("--apply");

  // Grupos com mais de UM ticket ATIVO (status != RESOLVED) no mesmo
  // contato+canal. RESOLVED nao entra na contagem — e' historico.
  const groups = await prisma.$queryRaw<
    { organizationId: string; contactId: string; channel: string; cnt: bigint }[]
  >`
    SELECT "organizationId", "contactId", "channel", COUNT(*) AS cnt
    FROM "conversations"
    WHERE "status" <> 'RESOLVED'
    GROUP BY "organizationId", "contactId", "channel"
    HAVING COUNT(*) > 1
  `;

  console.log(
    `[merge] ${groups.length} grupo(s) contato+canal com tickets ATIVOS duplicados${
      apply ? "" : " (dry-run — use --apply para consolidar)"
    }`,
  );

  let mergedConvs = 0;
  let movedMessages = 0;

  for (const g of groups) {
    const convs = (await prisma.conversation.findMany({
      where: {
        organizationId: g.organizationId,
        contactId: g.contactId,
        channel: g.channel,
        status: { not: "RESOLVED" },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        number: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        unreadCount: true,
      },
    })) as ConvRow[];

    if (convs.length < 2) continue;

    const canonical = convs[0];
    const dups = convs.slice(1);
    const dupIds = dups.map((c) => c.id);

    console.log(
      `  contato=${g.contactId} canal=${g.channel} → mantem #${canonical.number} (${canonical.id}); mescla ${dupIds.length}: ${dups
        .map((d) => `#${d.number}`)
        .join(", ")}`,
    );

    if (!apply) {
      mergedConvs += dupIds.length;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const m = await tx.message.updateMany({
        where: { conversationId: { in: dupIds } },
        data: { conversationId: canonical.id },
      });
      movedMessages += m.count;

      await tx.whatsappCallEvent.updateMany({
        where: { conversationId: { in: dupIds } },
        data: { conversationId: canonical.id },
      });
      await tx.scheduledWhatsappCall.updateMany({
        where: { conversationId: { in: dupIds } },
        data: { conversationId: canonical.id },
      });
      await tx.scheduledMessage.updateMany({
        where: { conversationId: { in: dupIds } },
        data: { conversationId: canonical.id },
      });
      await tx.activityEvent.updateMany({
        where: { conversationId: { in: dupIds } },
        data: { conversationId: canonical.id },
      });
      // PinnedMessage tem @@unique([conversationId, messageId]); repointar
      // pode colidir. Fixados sao efemeros — descartamos os dos duplicados.
      await tx.pinnedMessage.deleteMany({
        where: { conversationId: { in: dupIds } },
      });

      await tx.conversation.deleteMany({ where: { id: { in: dupIds } } });

      const [lastIn, lastMsg, outCount] = await Promise.all([
        tx.message.findFirst({
          where: { conversationId: canonical.id, direction: "in" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        tx.message.findFirst({
          where: { conversationId: canonical.id },
          orderBy: { createdAt: "desc" },
          select: { direction: true },
        }),
        tx.message.count({
          where: { conversationId: canonical.id, direction: "out" },
        }),
      ]);

      const totalUnread = convs.reduce((s, c) => s + (c.unreadCount ?? 0), 0);
      const newUpdatedAt = convs.reduce(
        (max, c) => (c.updatedAt > max ? c.updatedAt : max),
        canonical.updatedAt,
      );

      await tx.conversation.update({
        where: { id: canonical.id },
        data: {
          lastInboundAt: lastIn?.createdAt ?? null,
          lastMessageDirection: lastMsg?.direction ?? null,
          hasAgentReply: outCount > 0,
          unreadCount: totalUnread,
          updatedAt: newUpdatedAt,
        },
      });
    });

    mergedConvs += dupIds.length;
  }

  console.log(
    apply
      ? `[merge] concluido — ${mergedConvs} ticket(s) ativo(s) duplicado(s) mesclados, ${movedMessages} mensagem(ns) movidas.`
      : `[merge] dry-run — ${mergedConvs} ticket(s) ativo(s) duplicado(s) seriam mesclados. Rode com --apply para consolidar.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
