/**
 * Mock de demandas para teste local. Roda uma vez por org quando
 * os boards padrão existem e ainda não há nenhum card.
 */

import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { getRequestContext } from "@/lib/request-context";

type MockCard = {
  stageKey: string;
  title: string;
  description: string;
  kind: "FEATURE" | "IMPROVEMENT" | "BUG" | "REQUEST" | "TASK";
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  votes: number;
  tags: string[];
  comment?: string;
  done?: boolean;
};

const ROADMAP: MockCard[] = [
  {
    stageKey: "ideas",
    title: "Aba de conversas não lidas na Inbox",
    description: "Fila só com mensagens não lidas, no padrão do WhatsApp, para o operador não caçar lead respondido no meio da lista.",
    kind: "FEATURE",
    priority: "HIGH",
    votes: 18,
    tags: ["inbox", "ux"],
  },
  {
    stageKey: "ideas",
    title: "Gatilho de novo seguidor no Instagram",
    description: "Ao seguir o perfil, disparar automação no Direct com delay configurável.",
    kind: "FEATURE",
    priority: "MEDIUM",
    votes: 11,
    tags: ["automação", "instagram"],
  },
  {
    stageKey: "ideas",
    title: "Switch no editor de automações",
    description: "Bloco com N saídas (como N8N), em vez de encadear vários sim/não.",
    kind: "IMPROVEMENT",
    priority: "MEDIUM",
    votes: 9,
    tags: ["automação"],
  },
  {
    stageKey: "ideas",
    title: "Mencionar atendente em comentário interno",
    description: "No chat interno do ticket, @mencionar outro agente e notificar.",
    kind: "FEATURE",
    priority: "LOW",
    votes: 7,
    tags: ["inbox"],
  },
  {
    stageKey: "triage",
    title: "Filtro do dashboard por pipeline e tag",
    description: "Visão geral do home filtrável quando a conta tem vários produtos/funis.",
    kind: "FEATURE",
    priority: "HIGH",
    votes: 14,
    tags: ["dashboard"],
    comment: "Validar se os widgets atuais já aceitam filtro por funil antes de desenhar tela nova.",
  },
  {
    stageKey: "triage",
    title: "Preview de imagem no WhatsApp da Inbox",
    description: "Abrir a mídia sem baixar, com zoom e download.",
    kind: "IMPROVEMENT",
    priority: "MEDIUM",
    votes: 8,
    tags: ["inbox", "mídia"],
  },
  {
    stageKey: "analysis",
    title: "Reordenar kanban pela última mensagem",
    description: "Cards do funil sobem quando o lead responde — hoje a ordem é só posição manual.",
    kind: "FEATURE",
    priority: "HIGH",
    votes: 22,
    tags: ["pipeline"],
  },
  {
    stageKey: "analysis",
    title: "Meta de vendas no CRM",
    description: "Meta mensal por agente e por equipe, com barra no dashboard.",
    kind: "FEATURE",
    priority: "MEDIUM",
    votes: 12,
    tags: ["dashboard", "vendas"],
  },
  {
    stageKey: "planned",
    title: "Campos visíveis no card do funil",
    description: "Operador escolhe quais campos (padrão + personalizados) aparecem no card do kanban.",
    kind: "FEATURE",
    priority: "HIGH",
    votes: 16,
    tags: ["pipeline"],
  },
  {
    stageKey: "planned",
    title: "Condicional de janela WhatsApp aberta/fechada",
    description: "Na automação, ramificar se a janela de 24h está aberta antes de enviar template.",
    kind: "FEATURE",
    priority: "HIGH",
    votes: 10,
    tags: ["automação", "whatsapp"],
  },
  {
    stageKey: "in_progress",
    title: "Mensagens rápidas por departamento",
    description: "Cada departamento vê só os atalhos dele no composer da Inbox.",
    kind: "FEATURE",
    priority: "URGENT",
    votes: 24,
    tags: ["inbox", "departamentos"],
    comment: "Já existe grupo de quick reply — falta o recorte por departamento no composer.",
  },
  {
    stageKey: "in_progress",
    title: "App mobile: abrir conversa de lead da base",
    description: "No APK, iniciar conversa com contato já cadastrado sem passar pelo inbox web.",
    kind: "FEATURE",
    priority: "HIGH",
    votes: 13,
    tags: ["mobile"],
  },
  {
    stageKey: "test",
    title: "Subcategorias de templates Meta",
    description: "Agrupar templates por categoria/utilidade no seletor da Inbox.",
    kind: "IMPROVEMENT",
    priority: "MEDIUM",
    votes: 6,
    tags: ["templates"],
  },
  {
    stageKey: "done",
    title: "Merge de contatos duplicados",
    description: "Unificar leads com telefone igual, preservando histórico de tickets.",
    kind: "FEATURE",
    priority: "HIGH",
    votes: 19,
    tags: ["contatos"],
    done: true,
  },
  {
    stageKey: "done",
    title: "Filtro por período no chat",
    description: "Recortar a timeline da conversa por intervalo de datas.",
    kind: "FEATURE",
    priority: "LOW",
    votes: 5,
    tags: ["inbox"],
    done: true,
  },
];

const BUGS: MockCard[] = [
  {
    stageKey: "open",
    title: "Áudio some ao trocar de conversa",
    description: "Player da Inbox perde o src se o operador muda de ticket no meio da reprodução.",
    kind: "BUG",
    priority: "HIGH",
    votes: 4,
    tags: ["inbox", "áudio"],
  },
  {
    stageKey: "open",
    title: "Kanban não atualiza tag após automação",
    description: "add_tag grava no contato mas o card do funil só refresca no F5.",
    kind: "BUG",
    priority: "MEDIUM",
    votes: 3,
    tags: ["pipeline", "automação"],
  },
  {
    stageKey: "confirmed",
    title: "Distribuição ignora horário de almoço",
    description: "Lead cai no agente mesmo com status pausa-almoço ativo.",
    kind: "BUG",
    priority: "URGENT",
    votes: 6,
    tags: ["distribuição"],
    comment: "Reproduzível no tenant piloto. Checar AgentSchedule.preLunchStopMinutes.",
  },
  {
    stageKey: "confirmed",
    title: "Template aprovado não aparece no seletor",
    description: "Status APPROVED na Meta, mas o composer lista como pendente.",
    kind: "BUG",
    priority: "HIGH",
    votes: 2,
    tags: ["templates"],
  },
  {
    stageKey: "fixing",
    title: "SSE da Inbox duplica mensagem enviada",
    description: "Echo local + evento do servidor geram bolha duplicada no próprio agente.",
    kind: "BUG",
    priority: "HIGH",
    votes: 5,
    tags: ["inbox"],
  },
  {
    stageKey: "qa",
    title: "Filtro salvo do funil aplica stage errado",
    description: "Saved filter com stageId antigo após reorder de etapas.",
    kind: "BUG",
    priority: "MEDIUM",
    votes: 1,
    tags: ["pipeline"],
  },
  {
    stageKey: "done",
    title: "Login MFA rejeita código válido no Safari",
    description: "TOTP falhava por clock skew > 1 step. Ajustado o window.",
    kind: "BUG",
    priority: "HIGH",
    votes: 3,
    tags: ["auth"],
    done: true,
  },
];

const SUPPORT: MockCard[] = [
  {
    stageKey: "open",
    title: "Cliente X: WhatsApp desconectou após restart",
    description: "Canal Baileys ficou em QR depois do deploy. Precisa re-parear e avisar o CS.",
    kind: "REQUEST",
    priority: "URGENT",
    votes: 2,
    tags: ["canais"],
  },
  {
    stageKey: "open",
    title: "Liberar permissão de campanha para o time CS",
    description: "Role customizada do CS não tem campaign:view. Pedido do gestor.",
    kind: "TASK",
    priority: "MEDIUM",
    votes: 1,
    tags: ["rbac"],
  },
  {
    stageKey: "analysis",
    title: "Importação de 8k leads travou no 40%",
    description: "CSV com DDD 11. Bulk operation em status RUNNING há 2h.",
    kind: "REQUEST",
    priority: "HIGH",
    votes: 3,
    tags: ["importação"],
    comment: "Checar bulk_operations e logs do worker.",
  },
  {
    stageKey: "waiting",
    title: "Aguardando WABA do cliente Y para templates",
    description: "Eles vão enviar o ID da conta Meta. Sem isso não dá para submeter o fluxo.",
    kind: "TASK",
    priority: "LOW",
    votes: 0,
    tags: ["meta"],
  },
  {
    stageKey: "done",
    title: "Resetar senha do operador da unidade Campinas",
    description: "Usuário lockout após 8 tentativas. Senha resetada e MFA reativado.",
    kind: "TASK",
    priority: "LOW",
    votes: 0,
    tags: ["acesso"],
    done: true,
  },
];

const BY_SLUG: Record<string, MockCard[]> = {
  roadmap: ROADMAP,
  bugs: BUGS,
  support: SUPPORT,
};

export async function seedDemandMocksIfEmpty() {
  const existing = await prisma.demandItem.count();
  if (existing > 0) return;

  const ctx = getRequestContext();
  const actorId = ctx?.userId;
  if (!actorId) return;

  const humans = await prisma.user.findMany({
    where: { type: "HUMAN", isErased: false },
    select: { id: true },
    take: 8,
  });
  const assignees = humans.map((u) => u.id);
  const pickAssignee = (i: number) =>
    assignees.length ? assignees[i % assignees.length]! : actorId;

  const boards = await prisma.demandBoard.findMany({
    where: { archivedAt: null },
    include: { stages: true },
  });

  let number = 1;
  for (const board of boards) {
    const cards = BY_SLUG[board.slug];
    if (!cards) continue;
    const stageByKey = new Map(board.stages.map((s) => [s.key, s]));
    const posByStage = new Map<string, number>();

    for (const card of cards) {
      const stage = stageByKey.get(card.stageKey);
      if (!stage) continue;
      const pos = (posByStage.get(stage.id) ?? 0) + 1000;
      posByStage.set(stage.id, pos);

      const item = await prisma.demandItem.create({
        data: withOrgFromCtx({
          boardId: board.id,
          stageId: stage.id,
          number: number++,
          title: card.title,
          description: card.description,
          kind: card.kind,
          priority: card.priority,
          position: pos,
          votesCount: card.votes,
          tags: card.tags,
          requesterId: actorId,
          assigneeId: pickAssignee(number),
          completedAt: card.done ? new Date() : null,
        }),
        select: { id: true },
      });

      await prisma.demandEvent.create({
        data: withOrgFromCtx({
          itemId: item.id,
          actorId,
          type: card.done ? "COMPLETED" : "CREATED",
          payload: { mock: true, stageName: stage.name },
        }),
      });

      if (card.comment) {
        await prisma.demandComment.create({
          data: withOrgFromCtx({
            itemId: item.id,
            authorId: actorId,
            content: card.comment,
          }),
        });
        await prisma.demandEvent.create({
          data: withOrgFromCtx({
            itemId: item.id,
            actorId,
            type: "COMMENTED",
          }),
        });
      }

      const voteUsers = assignees.slice(0, Math.min(card.votes, assignees.length));
      if (voteUsers.length > 0) {
        await prisma.demandVote.createMany({
          data: voteUsers.map((userId) =>
            withOrgFromCtx({ itemId: item.id, userId }),
          ),
          skipDuplicates: true,
        });
      }
    }
  }
}
