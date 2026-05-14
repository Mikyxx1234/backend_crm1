/**
 * Seed de atendimentos fictícios para testar o visual do chat.
 *
 * Gera contatos, conversas e mensagens variadas cobrindo:
 *  - Sessões ativas (minutos, horas) e expiradas (>24h)
 *  - Direções in/out/system
 *  - Tipos: text, template, note, image, audio, document
 *  - Status sent/delivered/read/failed
 *  - Reply (quote), reactions, unread count
 *  - Tags e responsáveis
 *
 * Uso:
 *   npx tsx src/scripts/seed-mock-conversations.ts
 *
 * Para remover:
 *   npx tsx src/scripts/seed-mock-conversations.ts --reset
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MOCK_PREFIX = "mock-";

type MockContact = {
  id: string;
  name: string;
  phone: string;
  tags?: string[];
};

const CONTACTS: MockContact[] = [
  { id: `${MOCK_PREFIX}c1`, name: "Luz Oliveira ✨", phone: "+55 11 94262-2310", tags: ["Quente", "VIP"] },
  { id: `${MOCK_PREFIX}c2`, name: "Sergio Penteado", phone: "+55 11 98888-8888", tags: ["Parceiro"] },
  { id: `${MOCK_PREFIX}c3`, name: "Ernani da Silva", phone: "+55 11 97777-7777", tags: ["Quente"] },
  { id: `${MOCK_PREFIX}c4`, name: "Jéssica Mendes 😊", phone: "+55 11 96666-6666", tags: ["Indicação"] },
  { id: `${MOCK_PREFIX}c5`, name: "Vânia Martins", phone: "+55 11 95555-5555", tags: ["Frio"] },
  { id: `${MOCK_PREFIX}c6`, name: "Rafael Costa", phone: "+55 11 94444-4444", tags: ["VIP"] },
  { id: `${MOCK_PREFIX}c7`, name: "Marcelo Pinheiro", phone: "+55 11 93333-3333", tags: [] },
  { id: `${MOCK_PREFIX}c8`, name: "Ana Beatriz Ramos", phone: "+55 11 92222-2222", tags: ["Quente", "Indicação"] },
];

function minutesAgo(m: number): Date {
  return new Date(Date.now() - m * 60_000);
}
function hoursAgo(h: number): Date {
  return minutesAgo(h * 60);
}
function daysAgo(d: number): Date {
  return hoursAgo(d * 24);
}

async function resolveAdminId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return admin?.id ?? null;
}

async function resolveTagIds(names: string[]): Promise<{ id: string; name: string }[]> {
  if (names.length === 0) return [];
  const rows = await prisma.tag.findMany({ where: { name: { in: names } }, select: { id: true, name: true } });
  return rows;
}

async function reset() {
  console.log("[reset] Removendo mocks anteriores…");
  const convIds = (
    await prisma.conversation.findMany({
      where: { id: { startsWith: MOCK_PREFIX } },
      select: { id: true },
    })
  ).map((c) => c.id);

  if (convIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
  }

  // contatos mock — remove tags e depois o contato
  const contactIds = CONTACTS.map((c) => c.id);
  await prisma.tagOnContact.deleteMany({ where: { contactId: { in: contactIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });

  console.log(`[reset] ${convIds.length} conversas e ${contactIds.length} contatos removidos.`);
}

async function seed() {
  const adminId = await resolveAdminId();
  if (!adminId) {
    throw new Error("Nenhum usuário ADMIN encontrado. Rode o seed principal antes (npm run db:seed).");
  }

  const admin = await prisma.user.findUnique({
    where: { id: adminId },
    select: { organizationId: true },
  });
  if (!admin?.organizationId) {
    throw new Error("Admin sem organizationId. Seed multi-tenancy nao foi rodado.");
  }
  const organizationId = admin.organizationId;

  console.log(`[seed] Usando admin=${adminId} como responsável/agente.`);

  // --- garantir contatos ---
  for (const c of CONTACTS) {
    await prisma.contact.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        organizationId,
        name: c.name,
        phone: c.phone,
        lifecycleStage: "LEAD",
        assignedToId: adminId,
      },
      update: { name: c.name, phone: c.phone, assignedToId: adminId },
    });

    if (c.tags && c.tags.length > 0) {
      const tagRows = await resolveTagIds(c.tags);
      for (const t of tagRows) {
        await prisma.tagOnContact.upsert({
          where: { contactId_tagId: { contactId: c.id, tagId: t.id } },
          create: { contactId: c.id, tagId: t.id },
          update: {},
        });
      }
    }
  }
  console.log(`[seed] ${CONTACTS.length} contatos prontos.`);

  // --- conversas + mensagens ---

  const scenarios: Array<{
    contactIdx: number;
    convId: string;
    status: "OPEN" | "RESOLVED" | "PENDING";
    lastInboundMinutesAgo: number | null;
    unread: number;
    build: (convId: string, now: Date) => Array<{
      content: string;
      direction: "in" | "out" | "system";
      messageType?: string;
      isPrivate?: boolean;
      senderName?: string;
      createdAt: Date;
      replyToPreview?: string;
      reactions?: Array<{ emoji: string; senderName: string }>;
      sendStatus?: string;
      sendError?: string;
      mediaUrl?: string;
    }>;
  }> = [
    // 1) Luz — ativa AGORA, muitas mensagens variadas (cenário rico)
    {
      contactIdx: 0,
      convId: `${MOCK_PREFIX}conv1`,
      status: "OPEN",
      lastInboundMinutesAgo: 1,
      unread: 0,
      build: (_id) => [
        { content: "Oi, passando pra atualizar o status do pagamento pendente.", direction: "in", createdAt: minutesAgo(12), senderName: "Luz Oliveira" },
        { content: "Opa Luz, tudo bem?", direction: "out", createdAt: minutesAgo(11), senderName: "Admin EduIT", sendStatus: "read" },
        { content: "Tudo certo sim! Já consegui fazer o Pix agora pouco.", direction: "in", createdAt: minutesAgo(10), senderName: "Luz Oliveira" },
        { content: "Cliente chamou por template de cobrança", direction: "out", messageType: "note", isPrivate: true, senderName: "Admin EduIT", createdAt: minutesAgo(9) },
        { content: "Perfeito! Vou confirmar aqui no sistema e te retorno em 2 minutos.", direction: "out", createdAt: minutesAgo(8), senderName: "Admin EduIT", sendStatus: "read", replyToPreview: "Tudo certo sim! Já consegui fazer o Pix agora pouco." },
        { content: "Confirmado ✅ pagamento recebido. Obrigado pela agilidade!", direction: "out", createdAt: minutesAgo(3), senderName: "Admin EduIT", sendStatus: "delivered", reactions: [{ emoji: "🙏", senderName: "Luz Oliveira" }] },
        { content: "Muito obrigada você! Já me sinto mais tranquila 😊", direction: "in", createdAt: minutesAgo(1), senderName: "Luz Oliveira" },
      ],
    },

    // 2) Sergio — sessão ativa há ~2h (verde/amarela), com reply e 1 não lida
    {
      contactIdx: 1,
      convId: `${MOCK_PREFIX}conv2`,
      status: "OPEN",
      lastInboundMinutesAgo: 120,
      unread: 1,
      build: (_id) => [
        { content: "Bom dia! Queria saber mais sobre o curso de Gestão de Polos.", direction: "in", createdAt: hoursAgo(3), senderName: "Sergio Penteado" },
        { content: "Bom dia Sergio! Claro, vou te enviar as informações.", direction: "out", createdAt: hoursAgo(3), senderName: "Admin EduIT", sendStatus: "read" },
        { content: "📎 ementa-gestao-polos.pdf", direction: "out", messageType: "document", mediaUrl: "/uploads/mock/ementa-gestao-polos.pdf", senderName: "Admin EduIT", createdAt: hoursAgo(2.5), sendStatus: "read" },
        { content: "Show! Vou dar uma olhada e volto.", direction: "in", createdAt: hoursAgo(2.4), senderName: "Sergio Penteado" },
        { content: "Tá liberado, qualquer dúvida me chama.", direction: "out", createdAt: hoursAgo(2.3), senderName: "Admin EduIT", sendStatus: "delivered" },
        { content: "Li aqui, tem alguma turma começando mês que vem?", direction: "in", createdAt: hoursAgo(2), senderName: "Sergio Penteado", replyToPreview: "Tá liberado, qualquer dúvida me chama." },
      ],
    },

    // 3) Ernani — com 3 não lidas, sessão ativa ~4h, imagem
    {
      contactIdx: 2,
      convId: `${MOCK_PREFIX}conv3`,
      status: "OPEN",
      lastInboundMinutesAgo: 240,
      unread: 3,
      build: (_id) => [
        { content: "Segue a imagem do boleto que recebi, pode conferir?", direction: "in", createdAt: hoursAgo(5), senderName: "Ernani da Silva", messageType: "image", mediaUrl: "https://picsum.photos/seed/boleto1/600/400" },
        { content: "Oi Ernani, vou verificar agora.", direction: "out", createdAt: hoursAgo(5), senderName: "Admin EduIT", sendStatus: "read" },
        { content: "Estou aguardando o financeiro responder.", direction: "out", createdAt: hoursAgo(4.5), senderName: "Admin EduIT", sendStatus: "read" },
        { content: "Beleza, aguardo.", direction: "in", createdAt: hoursAgo(4.3), senderName: "Ernani da Silva" },
        { content: "Obrigado pela paciência 🙏", direction: "in", createdAt: hoursAgo(4.2), senderName: "Ernani da Silva" },
        { content: "E aí, teve retorno?", direction: "in", createdAt: hoursAgo(4), senderName: "Ernani da Silva" },
      ],
    },

    // 4) Jéssica — sessão quase expirando (~22h), áudio e emoji
    {
      contactIdx: 3,
      convId: `${MOCK_PREFIX}conv4`,
      status: "OPEN",
      lastInboundMinutesAgo: 22 * 60,
      unread: 0,
      build: (_id) => [
        { content: "Oi, tudo bem? Pode me explicar sobre o pagamento?", direction: "in", createdAt: daysAgo(1), senderName: "Jéssica Mendes" },
        { content: "Oi Jéssica! Claro, pode me mandar um áudio contando o que aconteceu?", direction: "out", createdAt: daysAgo(1), senderName: "Admin EduIT", sendStatus: "read" },
        { content: "📎 audio.ogg", direction: "in", messageType: "audio", mediaUrl: "/uploads/mock/jessica-audio.ogg", senderName: "Jéssica Mendes", createdAt: hoursAgo(23) },
        { content: "Entendi, vou resolver isso pra você hoje mesmo.", direction: "out", createdAt: hoursAgo(23), senderName: "Admin EduIT", sendStatus: "read" },
        { content: "Muito obrigada! 💙", direction: "in", createdAt: hoursAgo(22), senderName: "Jéssica Mendes", reactions: [{ emoji: "❤️", senderName: "Admin EduIT" }] },
      ],
    },

    // 5) Vânia — EXPIRADA (>24h), sem agent reply, 2 não lidas
    {
      contactIdx: 4,
      convId: `${MOCK_PREFIX}conv5`,
      status: "OPEN",
      lastInboundMinutesAgo: 30 * 60,
      unread: 2,
      build: (_id) => [
        { content: "Olá! Vi o anúncio do curso e gostaria de saber o valor.", direction: "in", createdAt: daysAgo(2), senderName: "Vânia Martins" },
        { content: "Ainda tem vaga?", direction: "in", createdAt: hoursAgo(31), senderName: "Vânia Martins" },
        { content: "Alguém pode me responder? Preciso decidir até amanhã.", direction: "in", createdAt: hoursAgo(30), senderName: "Vânia Martins" },
      ],
    },

    // 6) Rafael — resolvido com falha em uma mensagem (sendStatus=failed)
    {
      contactIdx: 5,
      convId: `${MOCK_PREFIX}conv6`,
      status: "RESOLVED",
      lastInboundMinutesAgo: 2 * 60,
      unread: 0,
      build: (_id) => [
        { content: "Oi, consegui acessar o portal, obrigado!", direction: "in", createdAt: hoursAgo(3), senderName: "Rafael Costa" },
        { content: "Disponha Rafael, qualquer coisa me chama.", direction: "out", createdAt: hoursAgo(3), senderName: "Admin EduIT", sendStatus: "read" },
        { content: "Só mais uma dúvida: como renovar?", direction: "in", createdAt: hoursAgo(2.5), senderName: "Rafael Costa" },
        { content: "Vou te enviar o link agora.", direction: "out", createdAt: hoursAgo(2.2), senderName: "Admin EduIT", sendStatus: "failed", sendError: "Falha ao conectar com a Meta API (timeout)" },
        { content: "https://eduit.com/renovar", direction: "out", createdAt: hoursAgo(2), senderName: "Admin EduIT", sendStatus: "read" },
        { content: "Perfeito, obrigado!", direction: "in", createdAt: hoursAgo(2), senderName: "Rafael Costa" },
      ],
    },

    // 7) Marcelo — conversa curta e recém-respondida
    {
      contactIdx: 6,
      convId: `${MOCK_PREFIX}conv7`,
      status: "OPEN",
      lastInboundMinutesAgo: 6 * 60,
      unread: 0,
      build: (_id) => [
        { content: "Bom dia! Preciso atualizar meu cadastro.", direction: "in", createdAt: hoursAgo(7), senderName: "Marcelo Pinheiro" },
        { content: "Bom dia Marcelo, te mando o link de atualização.", direction: "out", createdAt: hoursAgo(7), senderName: "Admin EduIT", sendStatus: "read" },
        { content: "https://eduit.com/cadastro/atualizar", direction: "out", createdAt: hoursAgo(6.5), senderName: "Admin EduIT", sendStatus: "read", reactions: [{ emoji: "👍", senderName: "Marcelo Pinheiro" }] },
        { content: "Obrigado!", direction: "in", createdAt: hoursAgo(6), senderName: "Marcelo Pinheiro" },
      ],
    },

    // 8) Ana — template marketing + múltiplas respostas, sessão ativa 30min
    {
      contactIdx: 7,
      convId: `${MOCK_PREFIX}conv8`,
      status: "OPEN",
      lastInboundMinutesAgo: 30,
      unread: 1,
      build: (_id) => [
        {
          content: "[TEMPLATE:promo_abril_2026][CAT:marketing]\n\nOlá Ana! 🌸\n\nNovas turmas abriram com 20% de desconto por tempo limitado. Quer receber mais detalhes?",
          direction: "out",
          messageType: "template",
          senderName: "Admin EduIT",
          createdAt: hoursAgo(2),
          sendStatus: "read",
        },
        { content: "Quero sim! Pode mandar?", direction: "in", createdAt: hoursAgo(1.5), senderName: "Ana Beatriz Ramos" },
        { content: "Perfeito Ana! Vou te mandar tudo agora.", direction: "out", createdAt: hoursAgo(1.5), senderName: "Admin EduIT", sendStatus: "read" },
        { content: "📎 catalogo-abril.pdf", direction: "out", messageType: "document", mediaUrl: "/uploads/mock/catalogo-abril.pdf", senderName: "Admin EduIT", createdAt: hoursAgo(1.4), sendStatus: "read" },
        { content: "Nota: Ana demonstrou muito interesse, follow-up em 2 dias", direction: "out", messageType: "note", isPrivate: true, senderName: "Admin EduIT", createdAt: hoursAgo(1.3) },
        { content: "Nossa, excelente!! Vou ler e já te respondo!", direction: "in", createdAt: minutesAgo(40), senderName: "Ana Beatriz Ramos" },
        { content: "Aproveita que é só até sexta 😊", direction: "out", createdAt: minutesAgo(35), senderName: "Admin EduIT", sendStatus: "delivered" },
        { content: "Tenho uma dúvida sobre o pagamento parcelado...", direction: "in", createdAt: minutesAgo(30), senderName: "Ana Beatriz Ramos" },
      ],
    },
  ];

  for (const sc of scenarios) {
    const contact = CONTACTS[sc.contactIdx];
    const messages = sc.build(sc.convId, new Date());
    const lastInbound = messages.filter((m) => m.direction === "in").pop();
    const lastOutbound = messages.filter((m) => m.direction === "out").pop();

    // deleta versões antigas para evitar conflito de schema
    await prisma.message.deleteMany({ where: { conversationId: sc.convId } });
    await prisma.conversation.deleteMany({ where: { id: sc.convId } });

    await prisma.conversation.create({
      data: {
        id: sc.convId,
        organizationId,
        contactId: contact.id,
        channel: "whatsapp",
        status: sc.status,
        unreadCount: sc.unread,
        lastInboundAt: lastInbound?.createdAt,
        lastMessageDirection: messages[messages.length - 1]?.direction ?? null,
        hasAgentReply: !!lastOutbound,
        assignedToId: adminId,
      },
      select: { id: true },
    });

    for (const m of messages) {
      await prisma.message.create({
        data: {
          organizationId,
          conversationId: sc.convId,
          content: m.content,
          direction: m.direction,
          messageType: m.messageType ?? "text",
          isPrivate: m.isPrivate ?? false,
          senderName: m.senderName,
          mediaUrl: m.mediaUrl,
          replyToPreview: m.replyToPreview,
          reactions: (m.reactions ?? []) as never,
          sendStatus: m.sendStatus ?? "sent",
          sendError: m.sendError,
          createdAt: m.createdAt,
        },
      });
    }

    console.log(`[seed] ${contact.name} → ${messages.length} mensagens (${sc.status}${sc.unread > 0 ? `, ${sc.unread} não lidas` : ""})`);
  }

  console.log(`\n✓ ${scenarios.length} atendimentos fictícios criados com sucesso.`);
  console.log("  Acesse /inbox e abra cada um para testar os cenários visuais.");
}

async function main() {
  const shouldReset = process.argv.includes("--reset");

  if (shouldReset) {
    await reset();
    return;
  }

  await seed();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
