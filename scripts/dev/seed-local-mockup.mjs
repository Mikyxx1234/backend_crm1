/**
 * Seed de mockup local — CRM
 * --------------------------
 * Popula o banco local com contatos, deals, conversas e mensagens realistas.
 * Idempotente: usa externalId com prefixo "local-seed-" para limpar antes de inserir.
 *
 * Uso:
 *   node scripts/dev/seed-local-mockup.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ log: [] });
const SEED_PREFIX = "local-seed-";

// ─── helpers ───────────────────────────────────────────────────────────────
const mins = (n) => new Date(Date.now() - n * 60_000);
const hours = (n) => mins(n * 60);
const days = (n) => hours(n * 24);

// ─── Dados fictícios ────────────────────────────────────────────────────────

const CONTACTS = [
  { key: "ana-beatriz",        name: "Ana Beatriz Ramos",       email: "ana.ramos@example.com",        phone: "+5511987654321", score: 85, source: "Landing Page",  tags: ["Quente", "VIP"]       },
  { key: "bruno-costa",        name: "Bruno Costa",             email: "bruno.costa@example.com",       phone: "+5521998765432", score: 42, source: "Indicação",     tags: ["Indicação"]           },
  { key: "carla-pereira",      name: "Carla Pereira",           email: "carla.pereira@example.com",     phone: "+5531987123456", score: 68, source: "Google Ads",    tags: ["Quente"]              },
  { key: "diego-alves",        name: "Diego Alves",             email: "diego.alves@example.com",       phone: "+5541998123456", score: 30, source: "Facebook",      tags: ["Frio"]                },
  { key: "erika-nunes",        name: "Érika Nunes",             email: "erika.nunes@example.com",       phone: "+5551987345678", score: 92, source: "Evento",        tags: ["VIP", "Quente"]       },
  { key: "fabio-ribeiro",      name: "Fábio Ribeiro",           email: "fabio.ribeiro@example.com",     phone: "+5561998456789", score: 55, source: "LinkedIn",      tags: ["Parceiro"]            },
  { key: "gabriela-souza",     name: "Gabriela Souza",          email: "gabriela.souza@example.com",    phone: "+5571987567890", score: 78, source: "Instagram",     tags: ["Quente"]              },
  { key: "henrique-lima",      name: "Henrique Lima",           email: "henrique.lima@example.com",     phone: "+5581998678901", score: 48, source: "Outbound",      tags: ["Frio"]                },
  { key: "isabela-martins",    name: "Isabela Martins",         email: "isabela.martins@example.com",   phone: "+5591987789012", score: 88, source: "Indicação",     tags: ["VIP", "Indicação"]    },
  { key: "joao-pedro",         name: "João Pedro Silva",        email: "joao.silva@example.com",        phone: "+5511996789012", score: 63, source: "Webinar",       tags: ["Quente"]              },
  { key: "karina-teixeira",    name: "Karina Teixeira",         email: "karina.teixeira@example.com",   phone: "+5521987890123", score: 25, source: "Orgânico",      tags: ["Frio"]                },
  { key: "leonardo-mendes",    name: "Leonardo Mendes",         email: "leonardo.mendes@example.com",   phone: "+5531998901234", score: 71, source: "Parceiro",      tags: ["Parceiro", "Quente"]  },
  { key: "mariana-azevedo",    name: "Mariana Azevedo",         email: "mariana.azevedo@example.com",   phone: "+5511994567890", score: 95, source: "Indicação",     tags: ["VIP", "Quente"]       },
  { key: "paulo-henrique",     name: "Paulo Henrique Coutinho", email: "paulo.coutinho@example.com",    phone: "+5521995678901", score: 18, source: "Outbound",      tags: ["Frio"]                },
  { key: "renata-figueiredo",  name: "Renata Figueiredo",       email: "renata.figueiredo@example.com", phone: "+5531996789012", score: 50, source: "Landing Page",  tags: ["Indicação"]           },
];

const DEALS = [
  // ── Qualificação ──
  {
    contactKey: "diego-alves",
    title: "Curso de IA — Diego Alves",
    value: 1490,
    stagePos: 0,
    status: "OPEN",
    product: "Curso de IA Aplicada",
    messages: [
      { content: "Oi, vi o anúncio e queria saber mais sobre o curso de IA.", direction: "in", minsAgo: 45 },
      { content: "O curso é online? Qual o valor?", direction: "in", minsAgo: 30 },
    ],
    unreadCount: 2,
  },
  {
    contactKey: "karina-teixeira",
    title: "Mentoria VIP — Karina Teixeira",
    value: 3200,
    stagePos: 0,
    status: "OPEN",
    product: "Mentoria VIP 6 meses",
    messages: [
      { content: "Bom dia! Gostaria de entender a mentoria que vocês oferecem.", direction: "in", minsAgo: 120 },
    ],
    unreadCount: 1,
  },
  {
    contactKey: "henrique-lima",
    title: "Escalabilidade B2B — Henrique Lima",
    value: 5800,
    stagePos: 0,
    status: "OPEN",
    product: "Consultoria de Escala",
    messages: [
      { content: "Olá Henrique, obrigado pelo interesse! Em que posso ajudar?", direction: "out", minsAgo: 180 },
      { content: "Henrique, chegou a dar uma olhada no material que enviei?", direction: "out", minsAgo: 60 },
    ],
  },

  // ── Contato Feito ──
  {
    contactKey: "ana-beatriz",
    title: "Curso de IA + Mentoria — Ana Beatriz",
    value: 4690,
    stagePos: 1,
    status: "OPEN",
    product: "Pacote Premium (Curso + Mentoria)",
    messages: [
      { content: "Oi! Vi no LinkedIn e adorei. Como funciona o pacote premium?", direction: "in", minsAgo: 240 },
      { content: "Ana, o pacote inclui o curso completo de IA (40h) + 6 sessões de mentoria 1:1. O investimento é R$ 4.690 em até 12x.", direction: "out", minsAgo: 220 },
      { content: "E as mentorias são gravadas?", direction: "in", minsAgo: 180 },
      { content: "Sim, você recebe todas as gravações por 2 anos.", direction: "out", minsAgo: 170 },
      { content: "Cliente demonstrou muito interesse. Tem orçamento aprovado pelo RH.", direction: "out", minsAgo: 160, isPrivate: true, pinned: true },
      { content: "Perfeito, me manda a proposta detalhada por favor.", direction: "in", minsAgo: 15 },
    ],
    unreadCount: 1,
  },
  {
    contactKey: "carla-pereira",
    title: "Curso de Growth — Carla Pereira",
    value: 2190,
    stagePos: 1,
    status: "OPEN",
    product: "Curso de Growth Marketing",
    messages: [
      { content: "Oi, tenho interesse no curso de growth.", direction: "in", minsAgo: 300 },
      { content: "Olá Carla! O curso tem 8 semanas, com aulas ao vivo toda terça. Quer ver o conteúdo programático?", direction: "out", minsAgo: 280 },
      { content: "Show, obrigada pelas infos. Vou conversar com meu sócio.", direction: "in", minsAgo: 180 },
    ],
  },
  {
    contactKey: "joao-pedro",
    title: "Workshop In-Company — João Pedro",
    value: 12500,
    stagePos: 1,
    status: "OPEN",
    product: "Workshop In-Company (2 dias)",
    messages: [
      { content: "João, enviei a agenda proposta pra agosto. Fechamos para a segunda quinzena?", direction: "out", minsAgo: 30 },
    ],
  },

  // ── Proposta Enviada ──
  {
    contactKey: "erika-nunes",
    title: "Consultoria Enterprise — Érika Nunes",
    value: 18900,
    stagePos: 2,
    status: "OPEN",
    product: "Consultoria Enterprise 12 meses",
    expectedCloseDays: 14,
    messages: [
      { content: "Érika, segue proposta anexa com escopo completo e cronograma de 12 meses.", direction: "out", minsAgo: 60 * 24 * 2 },
      { content: "Proposta enviada por e-mail com escopo premium.", direction: "out", minsAgo: 60 * 24 * 2 - 1, isPrivate: true },
    ],
  },
  {
    contactKey: "gabriela-souza",
    title: "Programa de Liderança — Gabriela Souza",
    value: 7800,
    stagePos: 2,
    status: "OPEN",
    product: "Programa de Liderança 360º",
    expectedCloseDays: 7,
    messages: [
      { content: "Gabriela, enviei a proposta pro programa de liderança. Qualquer dúvida estou à disposição!", direction: "out", minsAgo: 60 * 24 * 3 + 30 },
      { content: "Recebi, vou analisar com o RH e volto.", direction: "in", minsAgo: 60 * 24 * 3 },
    ],
  },

  // ── Negociação ──
  {
    contactKey: "fabio-ribeiro",
    title: "Parceria de Revenda — Fábio Ribeiro",
    value: 24000,
    stagePos: 3,
    status: "OPEN",
    product: "Licença Revenda Anual",
    expectedCloseDays: 5,
    messages: [
      { content: "Fábio, conseguimos fechar em 24k + renovação garantida.", direction: "out", minsAgo: 60 * 8 },
      { content: "Topamos os 24k se conseguirem dar 15% de desconto na renovação.", direction: "in", minsAgo: 60 * 5 },
      { content: "Margem mínima aceita: 12%. Preciso aprovação do gestor para fechar em 15%.", direction: "out", minsAgo: 60 * 4, isPrivate: true, pinned: true },
    ],
  },
  {
    contactKey: "leonardo-mendes",
    title: "Bootcamp de Dados — Leonardo Mendes",
    value: 3490,
    stagePos: 3,
    status: "OPEN",
    product: "Bootcamp Data Science 12 semanas",
    expectedCloseDays: 3,
    messages: [
      { content: "Gostei do bootcamp, mas o valor tá apertado pra mim.", direction: "in", minsAgo: 300 },
      { content: "Leonardo, fecho em 3.490 parcelado em 12x. Topa?", direction: "out", minsAgo: 90 },
    ],
  },

  // ── Fechamento ──
  {
    contactKey: "isabela-martins",
    title: "Licença Enterprise — Isabela Martins",
    value: 45000,
    stagePos: 4,
    status: "OPEN",
    product: "Licença Enterprise Anual",
    expectedCloseDays: 1,
    messages: [
      { content: "Contrato chegou, vamos revisar.", direction: "in", minsAgo: 60 * 24 },
      { content: "Contrato assinado! Pode mandar o PO pra emissão da NF.", direction: "in", minsAgo: 20 },
      { content: "Deal quente — prioridade máxima. Alinhar com financeiro amanhã.", direction: "out", minsAgo: 15, isPrivate: true, pinned: true },
    ],
    unreadCount: 1,
  },
  {
    contactKey: "bruno-costa",
    title: "Plano Anual Premium — Bruno Costa",
    value: 2988,
    stagePos: 4,
    status: "OPEN",
    product: "Plano Anual Premium",
    expectedCloseDays: 2,
    messages: [
      { content: "Manda o link do pagamento.", direction: "in", minsAgo: 120 },
      { content: "Bruno, segue link do checkout. Qualquer dúvida, me chama!", direction: "out", minsAgo: 45 },
    ],
  },

  // ── WON ──
  {
    contactKey: "mariana-azevedo",
    title: "Programa Liderança Executiva — Mariana Azevedo",
    value: 28500,
    stagePos: 4,
    status: "WON",
    product: "Programa Liderança Executiva 6m",
    convStatus: "RESOLVED",
    closedMinsAgo: 60 * 6,
    messages: [
      { content: "Adorei a proposta, vamos seguir.", direction: "in", minsAgo: 60 * 24 * 2 },
      { content: "Maravilha, Mariana! Envio o contrato hoje.", direction: "out", minsAgo: 60 * 24 * 2 - 30 },
      { content: "Recebi e assinei.", direction: "in", minsAgo: 60 * 12 },
      { content: "Pagamento efetuado, obrigada!", direction: "in", minsAgo: 60 * 7 },
      { content: "Cliente fechou. Conversão registrada às 14h.", direction: "out", minsAgo: 60 * 6, isPrivate: true },
    ],
  },

  // ── LOST ──
  {
    contactKey: "paulo-henrique",
    title: "Curso de IA Aplicada — Paulo Henrique",
    value: 1490,
    stagePos: 0,
    status: "LOST",
    product: "Curso de IA Aplicada",
    lostReason: "Sem orçamento neste momento",
    convStatus: "RESOLVED",
    closedMinsAgo: 60 * 24 * 3,
    messages: [
      { content: "Quanto custa o curso?", direction: "in", minsAgo: 60 * 24 * 5 },
      { content: "Paulo, fica 1.490 à vista ou 12x de 145.", direction: "out", minsAgo: 60 * 24 * 5 - 20 },
      { content: "Vou deixar pra outro semestre, valeu.", direction: "in", minsAgo: 60 * 24 * 3 + 10 },
      { content: "Lead descartado. Reabordar em 90d.", direction: "out", minsAgo: 60 * 24 * 3, isPrivate: true },
    ],
  },

  // ── Sem histórico (deal novo) ──
  {
    contactKey: "renata-figueiredo",
    title: "Workshop Express — Renata Figueiredo",
    value: 890,
    stagePos: 0,
    status: "OPEN",
    product: "Workshop Express (4h)",
    messages: [],
  },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("▶ Iniciando seed de mockup local…\n");

  // Admin local
  const admin = await prisma.user.findFirst({
    where: { isSuperAdmin: true },
    select: { id: true, email: true, organizationId: true },
  });
  if (!admin?.organizationId) throw new Error("Super-admin sem organizationId. Rode o seed base primeiro.");
  const orgId = admin.organizationId;
  console.log(`  ✔ Admin: ${admin.email}  (org: ${orgId})`);

  // Pipeline default
  const pipeline = await prisma.pipeline.findFirst({
    where: { organizationId: orgId, isDefault: true },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  if (!pipeline) throw new Error("Pipeline default não encontrado.");
  const stageIdByPos = new Map(pipeline.stages.map((s) => [s.position, s.id]));
  console.log(`  ✔ Pipeline: "${pipeline.name}" (${pipeline.stages.length} etapas)`);

  // Tags
  const TAG_MAP = { "Quente": "#ef4444", "Frio": "#3b82f6", "VIP": "#f59e0b", "Parceiro": "#22c55e", "Indicação": "#8b5cf6" };
  const tagIds = new Map();
  for (const [name, color] of Object.entries(TAG_MAP)) {
    const t = await prisma.tag.upsert({
      where: { organizationId_name: { organizationId: orgId, name } },
      update: { color },
      create: { organizationId: orgId, name, color },
    });
    tagIds.set(name, t.id);
  }
  console.log(`  ✔ Tags: ${[...tagIds.keys()].join(", ")}`);

  // ── Limpeza idempotente ──────────────────────────────────────────────────
  console.log("\n  • Limpando dados antigos do seed (local-seed-*)…");

  const oldConvIds = (await prisma.conversation.findMany({
    where: { externalId: { startsWith: SEED_PREFIX } },
    select: { id: true },
  })).map((c) => c.id);

  if (oldConvIds.length) {
    await prisma.message.deleteMany({ where: { conversationId: { in: oldConvIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: oldConvIds } } });
  }

  const oldDealIds = (await prisma.deal.findMany({
    where: { externalId: { startsWith: SEED_PREFIX } },
    select: { id: true },
  })).map((d) => d.id);

  if (oldDealIds.length) {
    await prisma.tagOnDeal.deleteMany({ where: { dealId: { in: oldDealIds } } });
    await prisma.deal.deleteMany({ where: { id: { in: oldDealIds } } });
  }

  const oldContactIds = (await prisma.contact.findMany({
    where: { externalId: { startsWith: SEED_PREFIX } },
    select: { id: true },
  })).map((c) => c.id);

  if (oldContactIds.length) {
    await prisma.tagOnContact.deleteMany({ where: { contactId: { in: oldContactIds } } });
    await prisma.contact.deleteMany({ where: { id: { in: oldContactIds } } });
  }

  console.log(`  ✔ Dados antigos removidos (${oldContactIds.length} contatos, ${oldDealIds.length} deals, ${oldConvIds.length} convs)`);

  // ── Calcular número do próximo deal ────────────────────────────────────
  const maxNumberRow = await prisma.deal.aggregate({
    where: { organizationId: orgId },
    _max: { number: true },
  });
  let nextDealNumber = (maxNumberRow._max.number ?? 0) + 1;

  // ── Inserir contatos ────────────────────────────────────────────────────
  console.log("\n  • Criando contatos…");
  const contactIdMap = new Map();

  // Número sequencial por organização (sem default no banco — atribuído aqui).
  const maxContactNumberRow = await prisma.contact.aggregate({
    where: { organizationId: orgId },
    _max: { number: true },
  });
  let nextContactNumber = (maxContactNumberRow._max.number ?? 0) + 1;

  for (const c of CONTACTS) {
    const contact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        number: nextContactNumber++,
        externalId: `${SEED_PREFIX}${c.key}`,
        name: c.name,
        email: c.email,
        phone: c.phone,
        leadScore: c.score,
        source: c.source,
        lifecycleStage: c.score >= 70 ? "SQL" : c.score >= 40 ? "MQL" : "LEAD",
        assignedToId: admin.id,
      },
    });
    contactIdMap.set(c.key, contact.id);

    for (const tagName of c.tags) {
      const tagId = tagIds.get(tagName);
      if (tagId) await prisma.tagOnContact.create({ data: { contactId: contact.id, tagId } });
    }
  }
  console.log(`  ✔ ${CONTACTS.length} contatos criados`);

  // ── Inserir deals + conversas + mensagens ───────────────────────────────
  console.log("\n  • Criando deals, conversas e mensagens…");
  let dealCount = 0, convCount = 0, msgCount = 0;

  for (const d of DEALS) {
    const contactId = contactIdMap.get(d.contactKey);
    if (!contactId) { console.warn(`  ⚠ Contato "${d.contactKey}" não encontrado, pulando.`); continue; }

    const stageId = stageIdByPos.get(d.stagePos);
    if (!stageId) { console.warn(`  ⚠ Etapa pos=${d.stagePos} não encontrada, pulando.`); continue; }

    const isClosed = d.status === "WON" || d.status === "LOST";
    const closedAt = isClosed ? mins(d.closedMinsAgo ?? 60) : null;

    const deal = await prisma.deal.create({
      data: {
        organizationId: orgId,
        externalId: `${SEED_PREFIX}deal-${d.contactKey}`,
        number: nextDealNumber++,
        title: d.title,
        value: d.value,
        status: d.status,
        stageId,
        contactId,
        ownerId: admin.id,
        position: dealCount,
        closedAt,
        lostReason: d.status === "LOST" ? (d.lostReason ?? null) : null,
        expectedClose: d.expectedCloseDays
          ? new Date(Date.now() + d.expectedCloseDays * 24 * 60 * 60 * 1000)
          : null,
      },
    });
    dealCount++;

    // Tags do deal (herdadas do contato)
    const seedContact = CONTACTS.find((c) => c.key === d.contactKey);
    for (const tagName of seedContact?.tags ?? []) {
      const tagId = tagIds.get(tagName);
      if (tagId) await prisma.tagOnDeal.create({ data: { dealId: deal.id, tagId } }).catch(() => {});
    }

    // Conversa
    const messages = d.messages ?? [];
    const lastInbound = [...messages].reverse().find((m) => m.direction === "in");
    const convStatus = d.convStatus ?? "OPEN";

    const conv = await prisma.conversation.create({
      data: {
        organizationId: orgId,
        externalId: `${SEED_PREFIX}conv-${d.contactKey}`,
        channel: "whatsapp",
        status: convStatus,
        contactId,
        assignedToId: admin.id,
        unreadCount: convStatus === "RESOLVED" ? 0 : (d.unreadCount ?? 0),
        lastInboundAt: lastInbound ? mins(lastInbound.minsAgo) : null,
        lastMessageDirection: messages.length ? messages[messages.length - 1].direction : null,
        hasAgentReply: messages.some((m) => m.direction === "out"),
        closedAt: convStatus === "RESOLVED" ? mins(d.closedMinsAgo ?? 60) : null,
      },
    });
    convCount++;

    // Mensagens (mais antigas primeiro)
    const sortedMsgs = [...messages].sort((a, b) => b.minsAgo - a.minsAgo);
    let pinnedMsgId = null;

    for (const m of sortedMsgs) {
      const msg = await prisma.message.create({
        data: {
          organizationId: orgId,
          conversationId: conv.id,
          content: m.content,
          direction: m.direction,
          messageType: "text",
          authorType: "human",
          isPrivate: m.isPrivate ?? false,
          senderName: m.isPrivate ? admin.email : null,
          sendStatus: m.direction === "out" ? "delivered" : "sent",
          createdAt: mins(m.minsAgo),
        },
      });
      msgCount++;
      if (m.pinned) pinnedMsgId = msg.id;
    }

    if (pinnedMsgId) {
      await prisma.conversation.update({ where: { id: conv.id }, data: { pinnedNoteId: pinnedMsgId } });
    }
  }

  console.log(`  ✔ ${dealCount} deals criados`);
  console.log(`  ✔ ${convCount} conversas criadas`);
  console.log(`  ✔ ${msgCount} mensagens criadas`);
  console.log("\n✅ Seed de mockup concluído!");
}

main()
  .catch((e) => { console.error("✗ Erro:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
