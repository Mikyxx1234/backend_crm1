/**
 * Seed fictício do Sales Hub
 * ──────────────────────────
 * Popula o pipeline padrão com leads variados em cada etapa, contatos
 * com dados realistas, tags coloridas, produtos e conversas com
 * mensagens (incluindo notas internas fixadas) — tudo preparado para
 * exercitar as features do Sales Hub (Quick Stage Move, filtros por
 * etapa, navegação por teclado, chat bimodal, etc).
 *
 * Uso:
 *   npx tsx prisma/seed-sales-hub.ts
 *   # ou via package.json: npm run seed:saleshub
 *
 * Idempotente: limpa apenas os dados marcados com `externalId` começando
 * com "sh-seed-" antes de reinserir, então pode ser rodado N vezes sem
 * duplicar. Dados reais (sem esse prefixo) ficam intactos.
 */

import { PrismaClient, DealStatus } from "@prisma/client";
import { ensureAllDealsHaveConversations } from "./ensure-deal-conversations";

const prisma = new PrismaClient();

// ─── Helpers ────────────────────────────────────────────────────────────

const SEED_PREFIX = "sh-seed-";
const PIPELINE_ID = "default-pipeline";

function minutesAgo(min: number): Date {
  return new Date(Date.now() - min * 60_000);
}
function hoursAgo(h: number): Date {
  return minutesAgo(h * 60);
}
function daysAgo(d: number): Date {
  return hoursAgo(d * 24);
}

// ─── Dados fictícios ────────────────────────────────────────────────────

type SeedContact = {
  key: string;
  name: string;
  email: string;
  phone: string;
  leadScore: number;
  source: string;
  tags: string[];
};

type SeedDeal = {
  contactKey: string;
  title: string;
  value: number;
  stageKey: string;
  status: DealStatus;
  productName?: string;
  ownerEmail?: string;
  expectedCloseDays?: number;
  lastMsgDirection?: "in" | "out";
  lastMsgContent?: string;
  lastMsgMinsAgo?: number;
  unreadCount?: number;
  /**
   * Status da conversa associada ao deal. Default `"OPEN"` (aberta).
   * Use `"RESOLVED"` para chats encerrados \u2014 deal continua no funil
   * mas o atendimento foi finalizado (regra de produto: encerrar
   * conversa N\u00c3O move o deal de etapa).
   */
  conversationStatus?: "OPEN" | "RESOLVED";
  /** Quando foi encerrada (s\u00f3 quando `conversationStatus === "RESOLVED"`). */
  closedMinsAgo?: number;
  /**
   * Quando o array \u00e9 omitido por completo, o deal ainda recebe uma
   * `Conversation` STUB sem mensagens. Permite validar o caso "lead
   * acabou de entrar e ainda n\u00e3o trocou mensagem".
   */
  messages?: Array<{
    content: string;
    direction: "in" | "out";
    minsAgo: number;
    isPrivate?: boolean;
    senderName?: string;
    pinned?: boolean;
  }>;
  lostReason?: string;
};

// Mapeamento dos nomes de etapa pro `position` (o id muda a cada seed).
const STAGE_BY_POSITION = {
  qualificacao: 0,
  contato: 1,
  proposta: 2,
  negociacao: 3,
  fechamento: 4,
} as const;

const CONTACTS: SeedContact[] = [
  {
    key: "ana-beatriz",
    name: "Ana Beatriz Ramos",
    email: "ana.ramos@example.com",
    phone: "+5511987654321",
    leadScore: 85,
    source: "Landing Page",
    tags: ["Quente", "VIP"],
  },
  {
    key: "bruno-costa",
    name: "Bruno Costa",
    email: "bruno.costa@example.com",
    phone: "+5521998765432",
    leadScore: 42,
    source: "Indicação",
    tags: ["Indicação"],
  },
  {
    key: "carla-pereira",
    name: "Carla Pereira",
    email: "carla.pereira@example.com",
    phone: "+5531987123456",
    leadScore: 68,
    source: "Google Ads",
    tags: ["Quente"],
  },
  {
    key: "diego-alves",
    name: "Diego Alves",
    email: "diego.alves@example.com",
    phone: "+5541998123456",
    leadScore: 30,
    source: "Facebook",
    tags: ["Frio"],
  },
  {
    key: "erika-nunes",
    name: "Erika Nunes",
    email: "erika.nunes@example.com",
    phone: "+5551987345678",
    leadScore: 92,
    source: "Evento",
    tags: ["VIP", "Quente"],
  },
  {
    key: "fabio-ribeiro",
    name: "Fábio Ribeiro",
    email: "fabio.ribeiro@example.com",
    phone: "+5561998456789",
    leadScore: 55,
    source: "LinkedIn",
    tags: ["Parceiro"],
  },
  {
    key: "gabriela-souza",
    name: "Gabriela Souza",
    email: "gabriela.souza@example.com",
    phone: "+5571987567890",
    leadScore: 78,
    source: "Instagram",
    tags: ["Quente"],
  },
  {
    key: "henrique-lima",
    name: "Henrique Lima",
    email: "henrique.lima@example.com",
    phone: "+5581998678901",
    leadScore: 48,
    source: "Outbound",
    tags: ["Frio"],
  },
  {
    key: "isabela-martins",
    name: "Isabela Martins",
    email: "isabela.martins@example.com",
    phone: "+5591987789012",
    leadScore: 88,
    source: "Indicação",
    tags: ["VIP", "Indicação"],
  },
  {
    key: "joao-pedro",
    name: "João Pedro Silva",
    email: "joao.silva@example.com",
    phone: "+5511996789012",
    leadScore: 63,
    source: "Webinar",
    tags: ["Quente"],
  },
  {
    key: "karina-teixeira",
    name: "Karina Teixeira",
    email: "karina.teixeira@example.com",
    phone: "+5521987890123",
    leadScore: 25,
    source: "Orgânico",
    tags: ["Frio"],
  },
  {
    key: "leonardo-mendes",
    name: "Leonardo Mendes",
    email: "leonardo.mendes@example.com",
    phone: "+5531998901234",
    leadScore: 71,
    source: "Parceiro",
    tags: ["Parceiro", "Quente"],
  },
  // ─── Contatos extras ──────────────────────────────────────────────
  // Garantem cobertura de cenários que o seed original não tinha:
  //  • mariana → deal GANHO + conversa encerrada (RESOLVED) recente.
  //  • paulo  → deal PERDIDO + conversa encerrada com motivo no card.
  //  • renata → deal sem mensagens trocadas ainda (cliente novo) —
  //             ainda assim recebe uma conversation stub OPEN sem
  //             mensagens, pra validar o caso "deal sem hist\u00f3rico".
  {
    key: "mariana-azevedo",
    name: "Mariana Azevedo",
    email: "mariana.azevedo@example.com",
    phone: "+5511994567890",
    leadScore: 95,
    source: "Indica\u00e7\u00e3o",
    tags: ["VIP", "Quente"],
  },
  {
    key: "paulo-henrique",
    name: "Paulo Henrique Coutinho",
    email: "paulo.coutinho@example.com",
    phone: "+5521995678901",
    leadScore: 18,
    source: "Outbound",
    tags: ["Frio"],
  },
  {
    key: "renata-figueiredo",
    name: "Renata Figueiredo",
    email: "renata.figueiredo@example.com",
    phone: "+5531996789012",
    leadScore: 50,
    source: "Landing Page",
    tags: ["Indica\u00e7\u00e3o"],
  },
];

const DEALS: SeedDeal[] = [
  // ───── Qualificação (3 deals — novos, baixo engajamento) ─────
  {
    contactKey: "diego-alves",
    title: "Curso de IA — Diego Alves",
    value: 1490,
    stageKey: "qualificacao",
    status: "OPEN",
    productName: "Curso de IA Aplicada",
    lastMsgDirection: "in",
    lastMsgContent: "Oi, vi o anúncio e queria saber mais sobre o curso…",
    lastMsgMinsAgo: 45,
    unreadCount: 2,
    messages: [
      {
        content: "Oi, vi o anúncio e queria saber mais sobre o curso de IA.",
        direction: "in",
        minsAgo: 45,
      },
      {
        content: "O curso é online? Qual o valor?",
        direction: "in",
        minsAgo: 30,
      },
    ],
  },
  {
    contactKey: "karina-teixeira",
    title: "Mentoria VIP — Karina Teixeira",
    value: 3200,
    stageKey: "qualificacao",
    status: "OPEN",
    productName: "Mentoria VIP 6 meses",
    lastMsgDirection: "in",
    lastMsgContent: "Bom dia! Gostaria de entender a mentoria…",
    lastMsgMinsAgo: 120,
    unreadCount: 1,
    messages: [
      {
        content: "Bom dia! Gostaria de entender a mentoria que vocês oferecem.",
        direction: "in",
        minsAgo: 120,
      },
    ],
  },
  {
    contactKey: "henrique-lima",
    title: "Escalabilidade B2B — Henrique Lima",
    value: 5800,
    stageKey: "qualificacao",
    status: "OPEN",
    productName: "Consultoria de Escala",
    lastMsgDirection: "out",
    lastMsgContent: "Henrique, chegou a dar uma olhada no material?",
    lastMsgMinsAgo: 60,
    messages: [
      {
        content: "Olá Henrique, obrigado pelo interesse! Em que posso ajudar?",
        direction: "out",
        minsAgo: 180,
      },
      {
        content: "Henrique, chegou a dar uma olhada no material que enviei?",
        direction: "out",
        minsAgo: 60,
      },
    ],
  },

  // ───── Contato Feito (3 deals — em diálogo ativo) ─────
  {
    contactKey: "ana-beatriz",
    title: "Curso de IA + Mentoria — Ana Beatriz",
    value: 4690,
    stageKey: "contato",
    status: "OPEN",
    productName: "Pacote Premium (Curso + Mentoria)",
    lastMsgDirection: "in",
    lastMsgContent: "Perfeito, me manda a proposta detalhada por favor.",
    lastMsgMinsAgo: 15,
    unreadCount: 1,
    messages: [
      {
        content: "Oi! Vi no LinkedIn e adorei. Como funciona o pacote premium?",
        direction: "in",
        minsAgo: 240,
      },
      {
        content:
          "Ana, o pacote inclui o curso completo de IA (40h) + 6 sessões de mentoria 1:1. O investimento é R$ 4.690 em até 12x.",
        direction: "out",
        minsAgo: 220,
      },
      {
        content: "E as mentorias são gravadas?",
        direction: "in",
        minsAgo: 180,
      },
      {
        content: "Sim, você recebe todas as gravações por 2 anos.",
        direction: "out",
        minsAgo: 170,
      },
      {
        content:
          "Cliente demonstrou muito interesse. Tem orçamento aprovado pelo RH.",
        direction: "out",
        minsAgo: 160,
        isPrivate: true,
        senderName: "Admin EduIT",
        pinned: true,
      },
      {
        content: "Perfeito, me manda a proposta detalhada por favor.",
        direction: "in",
        minsAgo: 15,
      },
    ],
  },
  {
    contactKey: "carla-pereira",
    title: "Curso de Growth — Carla Pereira",
    value: 2190,
    stageKey: "contato",
    status: "OPEN",
    productName: "Curso de Growth Marketing",
    lastMsgDirection: "in",
    lastMsgContent: "Show, obrigada pelas infos. Vou conversar com meu sócio.",
    lastMsgMinsAgo: 180,
    messages: [
      {
        content: "Oi, tenho interesse no curso de growth.",
        direction: "in",
        minsAgo: 300,
      },
      {
        content:
          "Olá Carla! O curso tem 8 semanas, com aulas ao vivo toda terça. Quer ver o conteúdo programático?",
        direction: "out",
        minsAgo: 280,
      },
      {
        content: "Show, obrigada pelas infos. Vou conversar com meu sócio.",
        direction: "in",
        minsAgo: 180,
      },
    ],
  },
  {
    contactKey: "joao-pedro",
    title: "Workshop In-Company — João Pedro",
    value: 12500,
    stageKey: "contato",
    status: "OPEN",
    productName: "Workshop In-Company (2 dias)",
    lastMsgDirection: "out",
    lastMsgContent: "João, enviei a agenda proposta pra agosto. Fechamos?",
    lastMsgMinsAgo: 30,
    messages: [
      {
        content:
          "João, enviei a agenda proposta pra agosto. Fechamos para a segunda quinzena?",
        direction: "out",
        minsAgo: 30,
      },
    ],
  },

  // ───── Proposta Enviada (2 deals — aguardando) ─────
  {
    contactKey: "erika-nunes",
    title: "Consultoria Enterprise — Erika Nunes",
    value: 18900,
    stageKey: "proposta",
    status: "OPEN",
    productName: "Consultoria Enterprise 12 meses",
    expectedCloseDays: 14,
    lastMsgDirection: "out",
    lastMsgContent: "Erika, segue proposta anexa com escopo e cronograma.",
    lastMsgMinsAgo: 60 * 24 * 2,
    messages: [
      {
        content:
          "Erika, segue proposta anexa com escopo completo e cronograma de 12 meses.",
        direction: "out",
        minsAgo: 60 * 24 * 2,
      },
      {
        content: "Proposta enviada por e-mail em 15/04 com escopo premium.",
        direction: "out",
        minsAgo: 60 * 24 * 2 - 1,
        isPrivate: true,
        senderName: "Admin EduIT",
      },
    ],
  },
  {
    contactKey: "gabriela-souza",
    title: "Programa de Liderança — Gabriela Souza",
    value: 7800,
    stageKey: "proposta",
    status: "OPEN",
    productName: "Programa de Liderança 360º",
    expectedCloseDays: 7,
    lastMsgDirection: "in",
    lastMsgContent: "Recebi, vou analisar com o RH e volto.",
    lastMsgMinsAgo: 60 * 24 * 3,
    messages: [
      {
        content:
          "Gabriela, enviei a proposta pro programa de liderança. Qualquer dúvida estou à disposição!",
        direction: "out",
        minsAgo: 60 * 24 * 3 + 30,
      },
      {
        content: "Recebi, vou analisar com o RH e volto.",
        direction: "in",
        minsAgo: 60 * 24 * 3,
      },
    ],
  },

  // ───── Negociação (2 deals — ajustando termos) ─────
  {
    contactKey: "fabio-ribeiro",
    title: "Parceria de Revenda — Fábio Ribeiro",
    value: 24000,
    stageKey: "negociacao",
    status: "OPEN",
    productName: "Licença Revenda Anual",
    expectedCloseDays: 5,
    lastMsgDirection: "in",
    lastMsgContent:
      "Topamos os 24k se conseguirem dar 15% de desconto na renovação.",
    lastMsgMinsAgo: 60 * 5,
    messages: [
      {
        content: "Fábio, conseguimos fechar em 24k + renovação garantida.",
        direction: "out",
        minsAgo: 60 * 8,
      },
      {
        content:
          "Topamos os 24k se conseguirem dar 15% de desconto na renovação.",
        direction: "in",
        minsAgo: 60 * 5,
      },
      {
        content:
          "Margem mínima aceita pela diretoria: 12%. Preciso aprovação do gestor pra fechar em 15%.",
        direction: "out",
        minsAgo: 60 * 4,
        isPrivate: true,
        senderName: "Admin EduIT",
        pinned: true,
      },
    ],
  },
  {
    contactKey: "leonardo-mendes",
    title: "Bootcamp de Dados — Leonardo Mendes",
    value: 3490,
    stageKey: "negociacao",
    status: "OPEN",
    productName: "Bootcamp Data Science 12 semanas",
    expectedCloseDays: 3,
    lastMsgDirection: "out",
    lastMsgContent: "Leonardo, fecho em 3.490 parcelado em 12x. Topa?",
    lastMsgMinsAgo: 90,
    messages: [
      {
        content: "Gostei do bootcamp, mas o valor tá apertado pra mim.",
        direction: "in",
        minsAgo: 300,
      },
      {
        content: "Leonardo, fecho em 3.490 parcelado em 12x. Topa?",
        direction: "out",
        minsAgo: 90,
      },
    ],
  },

  // ───── Fechamento (2 deals — prontos pra assinar) ─────
  {
    contactKey: "isabela-martins",
    title: "Licença Enterprise — Isabela Martins",
    value: 45000,
    stageKey: "fechamento",
    status: "OPEN",
    productName: "Licença Enterprise Anual",
    expectedCloseDays: 1,
    lastMsgDirection: "in",
    lastMsgContent: "Contrato assinado! Pode mandar o PO pra emissão da NF.",
    lastMsgMinsAgo: 20,
    unreadCount: 1,
    messages: [
      {
        content: "Contrato chegou, vamos revisar.",
        direction: "in",
        minsAgo: 60 * 24,
      },
      {
        content: "Contrato assinado! Pode mandar o PO pra emissão da NF.",
        direction: "in",
        minsAgo: 20,
      },
      {
        content:
          "Deal quente, fechamento imediato. Prioridade máxima — alinhar com financeiro amanhã.",
        direction: "out",
        minsAgo: 15,
        isPrivate: true,
        senderName: "Admin EduIT",
        pinned: true,
      },
    ],
  },
  {
    contactKey: "bruno-costa",
    title: "Plano Anual Premium — Bruno Costa",
    value: 2988,
    stageKey: "fechamento",
    status: "OPEN",
    productName: "Plano Anual Premium",
    expectedCloseDays: 2,
    lastMsgDirection: "out",
    lastMsgContent: "Bruno, segue link do checkout. Qualquer dúvida, me chama!",
    lastMsgMinsAgo: 45,
    messages: [
      {
        content: "Manda o link do pagamento.",
        direction: "in",
        minsAgo: 120,
      },
      {
        content:
          "Bruno, segue link do checkout. Qualquer dúvida, me chama!",
        direction: "out",
        minsAgo: 45,
      },
    ],
  },

  // ───── Cen\u00e1rios extras (cobrem WON / LOST / sem hist\u00f3rico) ─────
  {
    contactKey: "mariana-azevedo",
    title: "Programa Liderança Executiva — Mariana Azevedo",
    value: 28500,
    stageKey: "fechamento",
    status: "WON",
    productName: "Programa Liderança Executiva 6m",
    conversationStatus: "RESOLVED",
    closedMinsAgo: 60 * 6,
    lastMsgDirection: "in",
    lastMsgContent: "Pagamento efetuado, obrigada!",
    lastMsgMinsAgo: 60 * 7,
    messages: [
      { content: "Adorei a proposta, vamos seguir.", direction: "in", minsAgo: 60 * 24 * 2 },
      { content: "Maravilha, Mariana! Envio o contrato hoje.", direction: "out", minsAgo: 60 * 24 * 2 - 30 },
      { content: "Recebi e assinei.", direction: "in", minsAgo: 60 * 12 },
      { content: "Pagamento efetuado, obrigada!", direction: "in", minsAgo: 60 * 7 },
      {
        content: "Cliente fechou. Convers\u00e3o registrada \u00e0s 14h.",
        direction: "out",
        minsAgo: 60 * 6,
        isPrivate: true,
        senderName: "Admin EduIT",
      },
    ],
  },
  {
    contactKey: "paulo-henrique",
    title: "Curso de IA Aplicada — Paulo Henrique",
    value: 1490,
    stageKey: "qualificacao",
    status: "LOST",
    productName: "Curso de IA Aplicada",
    lostReason: "Sem or\u00e7amento neste momento",
    conversationStatus: "RESOLVED",
    closedMinsAgo: 60 * 24 * 3,
    lastMsgDirection: "in",
    lastMsgContent: "Vou deixar pra outro semestre, valeu.",
    lastMsgMinsAgo: 60 * 24 * 3 + 10,
    messages: [
      { content: "Quanto custa o curso?", direction: "in", minsAgo: 60 * 24 * 5 },
      { content: "Paulo, fica 1.490 \u00e0 vista ou 12x de 145.", direction: "out", minsAgo: 60 * 24 * 5 - 20 },
      { content: "Vou deixar pra outro semestre, valeu.", direction: "in", minsAgo: 60 * 24 * 3 + 10 },
      {
        content: "Lead descartado por falta de or\u00e7amento. Reabordar em 90d.",
        direction: "out",
        minsAgo: 60 * 24 * 3,
        isPrivate: true,
        senderName: "Admin EduIT",
      },
    ],
  },
  {
    contactKey: "renata-figueiredo",
    title: "Workshop Express — Renata Figueiredo",
    value: 890,
    stageKey: "qualificacao",
    status: "OPEN",
    productName: "Workshop Express (4h)",
    // Sem `messages` => recebe Conversation stub OPEN sem mensagens.
    // Valida: deal aparece no funil, no chat lista o contato com
    // estado vazio "Sem hist\u00f3rico ainda".
  },
];

// ─── Seed principal ─────────────────────────────────────────────────────

async function main() {
  console.log("▶ Iniciando seed do Sales Hub…");

  // Admin: precisa existir pra assinar as notas internas.
  const admin = await prisma.user.findFirst({
    where: { email: "admin@eduit.com" },
  });
  if (!admin) {
    throw new Error(
      "Usuário admin@eduit.com não encontrado. Rode `npx tsx prisma/seed.ts` antes.",
    );
  }
  if (!admin.organizationId) {
    throw new Error("Admin sem organizationId. Seed multi-tenancy nao foi rodado.");
  }
  const organizationId = admin.organizationId;

  // Pipeline + stages
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: PIPELINE_ID },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  if (!pipeline) {
    throw new Error(
      `Pipeline "${PIPELINE_ID}" não encontrado. Rode o seed base primeiro.`,
    );
  }
  const stageIdByPosition = new Map<number, string>();
  for (const s of pipeline.stages) stageIdByPosition.set(s.position, s.id);
  function stageIdFor(key: keyof typeof STAGE_BY_POSITION): string {
    const pos = STAGE_BY_POSITION[key];
    const id = stageIdByPosition.get(pos);
    if (!id) throw new Error(`Stage "${key}" (pos ${pos}) ausente no pipeline.`);
    return id;
  }

  // Tags (upsert por nome — compartilha com seed base)
  const TAG_COLORS: Record<string, string> = {
    Quente: "#ef4444",
    Frio: "#3b82f6",
    VIP: "#f59e0b",
    Parceiro: "#22c55e",
    Indicação: "#8b5cf6",
  };
  const tagByName = new Map<string, { id: string }>();
  for (const [name, color] of Object.entries(TAG_COLORS)) {
    const t = await prisma.tag.upsert({
      where: { organizationId_name: { organizationId, name } },
      update: { color },
      create: { organizationId, name, color },
    });
    tagByName.set(name, t);
  }
  console.log(`  ✔ Tags garantidas (${tagByName.size})`);

  // ─── Limpeza idempotente ──
  console.log("  • Removendo dados antigos do seed (sh-seed-*)…");
  // Ordem: messages → conversations → deals → contacts (cascade ajuda,
  // mas explicitamos pra evitar surpresa com FKs em dev).
  const oldConvs = await prisma.conversation.findMany({
    where: { externalId: { startsWith: SEED_PREFIX } },
    select: { id: true },
  });
  if (oldConvs.length) {
    await prisma.message.deleteMany({
      where: { conversationId: { in: oldConvs.map((c) => c.id) } },
    });
    await prisma.conversation.deleteMany({
      where: { id: { in: oldConvs.map((c) => c.id) } },
    });
  }
  const oldDeals = await prisma.deal.findMany({
    where: { externalId: { startsWith: SEED_PREFIX } },
    select: { id: true },
  });
  if (oldDeals.length) {
    await prisma.tagOnDeal.deleteMany({
      where: { dealId: { in: oldDeals.map((d) => d.id) } },
    });
    await prisma.deal.deleteMany({
      where: { id: { in: oldDeals.map((d) => d.id) } },
    });
  }
  const oldContacts = await prisma.contact.findMany({
    where: { externalId: { startsWith: SEED_PREFIX } },
    select: { id: true },
  });
  if (oldContacts.length) {
    await prisma.tagOnContact.deleteMany({
      where: { contactId: { in: oldContacts.map((c) => c.id) } },
    });
    await prisma.contact.deleteMany({
      where: { id: { in: oldContacts.map((c) => c.id) } },
    });
  }

  // ─── Inserir contatos ─────────────────────────────────────────────────
  const contactIdByKey = new Map<string, string>();
  for (const c of CONTACTS) {
    const externalId = `${SEED_PREFIX}${c.key}`;
    const created = await prisma.contact.create({
      data: {
        organizationId,
        externalId,
        name: c.name,
        email: c.email,
        phone: c.phone,
        leadScore: c.leadScore,
        source: c.source,
        lifecycleStage: c.leadScore >= 70 ? "SQL" : c.leadScore >= 40 ? "MQL" : "LEAD",
        assignedToId: admin.id,
      },
    });
    contactIdByKey.set(c.key, created.id);

    // Tags do contato
    for (const tagName of c.tags) {
      const tag = tagByName.get(tagName);
      if (!tag) continue;
      await prisma.tagOnContact.create({
        data: { contactId: created.id, tagId: tag.id },
      });
    }
  }
  console.log(`  ✔ ${CONTACTS.length} contatos criados`);

  // ─── Inserir deals + conversations + mensagens ───────────────────────
  let dealCount = 0;
  let convCount = 0;
  let msgCount = 0;

  for (const d of DEALS) {
    const contactId = contactIdByKey.get(d.contactKey);
    if (!contactId) continue;
    const stageId = stageIdFor(
      d.stageKey as keyof typeof STAGE_BY_POSITION,
    );

    const dealExternalId = `${SEED_PREFIX}deal-${d.contactKey}`;
    // Deal WON/LOST recebe `closedAt`. `lostReason` s\u00f3 quando perdido.
    const dealClosedAt =
      d.status === "WON" || d.status === "LOST"
        ? minutesAgo(d.closedMinsAgo ?? 60)
        : null;
    const deal = await prisma.deal.create({
      data: {
        organizationId,
        externalId: dealExternalId,
        title: d.title,
        value: d.value,
        status: d.status,
        stageId,
        contactId,
        ownerId: admin.id,
        expectedClose: d.expectedCloseDays
          ? new Date(Date.now() + d.expectedCloseDays * 24 * 60 * 60 * 1000)
          : null,
        position: dealCount,
        closedAt: dealClosedAt,
        lostReason: d.status === "LOST" ? d.lostReason ?? null : null,
        number: dealCount + 1,
      },
    });
    dealCount++;

    // Tags do deal (herda as do contato)
    const contact = CONTACTS.find((c) => c.key === d.contactKey);
    if (contact) {
      for (const tagName of contact.tags) {
        const tag = tagByName.get(tagName);
        if (!tag) continue;
        await prisma.tagOnDeal.create({
          data: { dealId: deal.id, tagId: tag.id },
        });
      }
    }

    // Conversa: SEMPRE criada (mesmo sem mensagens). Garante que
    // todo deal aparece no Chat \u2014 se est\u00e1 RESOLVED, vira "hist\u00f3rico"
    // (cliente clica e v\u00ea o que aconteceu); se est\u00e1 OPEN sem
    // mensagens, vira "lead novo, sem intera\u00e7\u00e3o ainda".
    const messages = d.messages ?? [];
    const lastInbound = [...messages].reverse().find((m) => m.direction === "in");
    const conversationStatus = d.conversationStatus ?? "OPEN";
    const conv = await prisma.conversation.create({
      data: {
        organizationId,
        externalId: `${SEED_PREFIX}conv-${d.contactKey}`,
        channel: "whatsapp",
        status: conversationStatus,
        contactId,
        assignedToId: admin.id,
        unreadCount: conversationStatus === "RESOLVED" ? 0 : d.unreadCount ?? 0,
        lastInboundAt: lastInbound ? minutesAgo(lastInbound.minsAgo) : null,
        lastMessageDirection: d.lastMsgDirection ?? null,
        hasAgentReply: messages.some((m) => m.direction === "out"),
        closedAt:
          conversationStatus === "RESOLVED"
            ? minutesAgo(d.closedMinsAgo ?? 60)
            : null,
      },
    });
    convCount++;

    // Ordena por idade desc (mais antigas primeiro) pra createdAt ficar
    // coerente com a linha do tempo.
    const sorted = [...messages].sort((a, b) => b.minsAgo - a.minsAgo);
    const created = [];
    for (const m of sorted) {
      const msg = await prisma.message.create({
        data: {
          organizationId,
          conversationId: conv.id,
          content: m.content,
          direction: m.direction,
          messageType: "text",
          authorType: m.isPrivate ? "human" : "human",
          isPrivate: m.isPrivate ?? false,
          senderName: m.senderName ?? null,
          sendStatus: m.direction === "out" ? "delivered" : "sent",
          createdAt: minutesAgo(m.minsAgo),
        },
      });
      created.push({ msg, pinned: m.pinned });
      msgCount++;
    }

    // Nota fixada — se houver mensagem marcada como `pinned: true`, amarra
    // em `Conversation.pinnedNoteId`.
    const pinnedEntry = created.find((c) => c.pinned);
    if (pinnedEntry) {
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { pinnedNoteId: pinnedEntry.msg.id },
      });
    }
  }

  console.log(`  ✔ ${dealCount} deals criados`);
  console.log(`  ✔ ${convCount} conversas criadas`);
  console.log(`  ✔ ${msgCount} mensagens criadas`);

  // ─── Garantia final: TODO deal do banco (inclusive os fora do seed
  // sh-seed-* — ex.: leads importados, criados manualmente em produção)
  // precisa ter conversa com histórico. Idempotente — só preenche o que
  // falta. Mantém o invariante "nenhum deal órfão de chat".
  console.log("");
  console.log("🔗 Garantindo conversas para todos os deals do banco…");
  const ensured = await ensureAllDealsHaveConversations(prisma, {
    verbose: false,
  });
  console.log(
    `  ✔ ${ensured.dealsProcessed} deals checados — ${ensured.conversationsCreated} convs e ${ensured.messagesCreated} msgs adicionadas`,
  );

  console.log("✅ Seed do Sales Hub concluído com sucesso!");
}

main()
  .catch((e) => {
    console.error("✗ Erro no seed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
