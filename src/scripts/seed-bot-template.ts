/**
 * Seed script: creates a bot-template automation inspired by DataCrazy structure.
 *
 * Usage:  npx tsx src/scripts/seed-bot-template.ts
 */
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── Step IDs (fixed so we can wire nextStepId / gotoStepId / elseStepId) ──
const ID = {
  bizHours: "tpl_01_biz_hours",
  offHoursMsg: "tpl_02_off_hours",
  offHoursFinish: "tpl_03_off_finish",
  greeting: "tpl_04_greeting",
  mainMenu: "tpl_05_main_menu",
  retryMain: "tpl_06_retry_main",
  subMenu1: "tpl_07_sub_menu_1",
  retrySub1: "tpl_08_retry_sub1",
  content1A: "tpl_09_content_1a",
  content1B: "tpl_10_content_1b",
  content2: "tpl_11_content_2",
  content3: "tpl_12_content_3",
  hub: "tpl_13_hub",
  retryHub: "tpl_14_retry_hub",
  goodbye: "tpl_15_goodbye",
  finishAll: "tpl_16_finish_all",
  transfer: "tpl_17_transfer",
  moveStage: "tpl_18_move_stage",
  inactivity: "tpl_19_inactivity",
  finishInact: "tpl_20_finish_inact",
} as const;

// ── Canvas positions (horizontal layout, left→right) ──
function pos(x: number, y: number) {
  return { x, y };
}

const Y_MAIN = 300;
const Y_OFF = 80;
const Y_RETRY = 520;
const Y_SUB_B = 140;
const Y_OPT2 = 520;
const Y_OPT3 = 680;
const Y_TRANSFER = 560;
const Y_INACT = 700;

const steps: {
  id: string;
  type: string;
  config: Record<string, unknown>;
}[] = [
  // ── 1. Business Hours ──
  {
    id: ID.bizHours,
    type: "business_hours",
    config: {
      schedule: [{ days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" }],
      timezone: "America/Sao_Paulo",
      elseStepId: ID.offHoursMsg,
      nextStepId: ID.greeting,
      __rfPos: pos(200, Y_MAIN),
    },
  },

  // ── 2. Off-hours message ──
  {
    id: ID.offHoursMsg,
    type: "send_whatsapp_message",
    config: {
      content:
        "Olá! Nosso horário de atendimento é de segunda a sexta, das 9h às 18h. Deixe sua mensagem que retornaremos assim que possível. 🕐",
      nextStepId: ID.offHoursFinish,
      __rfPos: pos(500, Y_OFF),
    },
  },

  // ── 3. Finish (off-hours) ──
  {
    id: ID.offHoursFinish,
    type: "finish_conversation",
    config: {
      __rfPos: pos(800, Y_OFF),
    },
  },

  // ── 4. Greeting ──
  {
    id: ID.greeting,
    type: "send_whatsapp_message",
    config: {
      content:
        "Olá! Bem-vindo ao nosso atendimento virtual. Como posso ajudá-lo hoje?",
      nextStepId: ID.mainMenu,
      __rfPos: pos(500, Y_MAIN),
    },
  },

  // ── 5. Main Menu (interactive buttons) ──
  {
    id: ID.mainMenu,
    type: "send_whatsapp_interactive",
    config: {
      body: "Escolha uma das opções abaixo:",
      buttons: [
        { id: "btn_opt1", title: "Informações", gotoStepId: ID.subMenu1 },
        { id: "btn_opt2", title: "Serviços", gotoStepId: ID.content2 },
        { id: "btn_opt3", title: "Suporte", gotoStepId: ID.content3 },
      ],
      elseGotoStepId: ID.retryMain,
      timeoutMs: 300_000, // 5 min
      timeoutAction: "goto",
      timeoutGotoStepId: ID.inactivity,
      saveToVariable: "menuChoice",
      __rfPos: pos(800, Y_MAIN),
    },
  },

  // ── 6. Retry Main Menu ──
  {
    id: ID.retryMain,
    type: "send_whatsapp_message",
    config: {
      content:
        "Desculpe, não entendi sua resposta. Por favor, escolha uma das opções abaixo.",
      nextStepId: ID.mainMenu,
      __rfPos: pos(800, Y_RETRY),
    },
  },

  // ── 7. SubMenu 1 (interactive) ──
  {
    id: ID.subMenu1,
    type: "send_whatsapp_interactive",
    config: {
      body: "Sobre qual assunto deseja saber mais?",
      buttons: [
        { id: "btn_sub_a", title: "Assunto A", gotoStepId: ID.content1A },
        { id: "btn_sub_b", title: "Assunto B", gotoStepId: ID.content1B },
        { id: "btn_back", title: "Voltar", gotoStepId: ID.mainMenu },
      ],
      elseGotoStepId: ID.retrySub1,
      timeoutMs: 300_000,
      timeoutAction: "goto",
      timeoutGotoStepId: ID.inactivity,
      saveToVariable: "subChoice",
      __rfPos: pos(1100, Y_MAIN),
    },
  },

  // ── 8. Retry SubMenu 1 ──
  {
    id: ID.retrySub1,
    type: "send_whatsapp_message",
    config: {
      content: "Não entendi. Escolha uma das opções, por favor.",
      nextStepId: ID.subMenu1,
      __rfPos: pos(1100, Y_RETRY),
    },
  },

  // ── 9. Content 1A ──
  {
    id: ID.content1A,
    type: "send_whatsapp_message",
    config: {
      content:
        "[Conteúdo do Assunto A — edite esta mensagem com as informações desejadas.]",
      nextStepId: ID.hub,
      __rfPos: pos(1400, Y_MAIN),
    },
  },

  // ── 10. Content 1B ──
  {
    id: ID.content1B,
    type: "send_whatsapp_message",
    config: {
      content:
        "[Conteúdo do Assunto B — edite esta mensagem com as informações desejadas.]",
      nextStepId: ID.hub,
      __rfPos: pos(1400, Y_SUB_B),
    },
  },

  // ── 11. Content 2 (Serviços) ──
  {
    id: ID.content2,
    type: "send_whatsapp_message",
    config: {
      content:
        "[Conteúdo sobre Serviços — edite esta mensagem com as informações desejadas.]",
      nextStepId: ID.hub,
      __rfPos: pos(1100, Y_OPT2),
    },
  },

  // ── 12. Content 3 (Suporte) ──
  {
    id: ID.content3,
    type: "send_whatsapp_message",
    config: {
      content:
        "[Conteúdo sobre Suporte — edite esta mensagem com as informações desejadas.]",
      nextStepId: ID.hub,
      __rfPos: pos(1100, Y_OPT3),
    },
  },

  // ── 13. Hub – "Mais alguma dúvida?" ──
  {
    id: ID.hub,
    type: "send_whatsapp_interactive",
    config: {
      body: "Posso ajudar em mais alguma coisa?",
      buttons: [
        { id: "btn_help", title: "Falar c/ atendente", gotoStepId: ID.transfer },
        { id: "btn_no", title: "Não, obrigado", gotoStepId: ID.goodbye },
        { id: "btn_restart", title: "Voltar ao início", gotoStepId: ID.mainMenu },
      ],
      elseGotoStepId: ID.retryHub,
      timeoutMs: 300_000,
      timeoutAction: "goto",
      timeoutGotoStepId: ID.inactivity,
      saveToVariable: "hubChoice",
      __rfPos: pos(1700, Y_MAIN),
    },
  },

  // ── 14. Retry Hub ──
  {
    id: ID.retryHub,
    type: "send_whatsapp_message",
    config: {
      content: "Não entendi. Escolha uma das opções abaixo, por favor.",
      nextStepId: ID.hub,
      __rfPos: pos(1700, Y_RETRY),
    },
  },

  // ── 15. Goodbye ──
  {
    id: ID.goodbye,
    type: "send_whatsapp_message",
    config: {
      content: "Obrigado pelo contato! Se precisar de algo mais, é só enviar uma mensagem. Até logo! 😊",
      nextStepId: ID.finishAll,
      __rfPos: pos(2000, Y_MAIN),
    },
  },

  // ── 16. Finish All ──
  {
    id: ID.finishAll,
    type: "finish_conversation",
    config: {
      __rfPos: pos(2300, Y_MAIN),
    },
  },

  // ── 17. Transfer to agent ──
  {
    id: ID.transfer,
    type: "send_whatsapp_message",
    config: {
      content:
        "Estou transferindo você para um atendente humano. Aguarde um momento, por favor.",
      nextStepId: ID.moveStage,
      __rfPos: pos(2000, Y_TRANSFER),
    },
  },

  // ── 18. Move deal stage (transfer) ──
  {
    id: ID.moveStage,
    type: "move_stage",
    config: {
      stageId: "",
      __rfPos: pos(2300, Y_TRANSFER),
    },
  },

  // ── 19. Inactivity message ──
  {
    id: ID.inactivity,
    type: "send_whatsapp_message",
    config: {
      content:
        "Parece que você ficou inativo. Estou encerrando a conversa por enquanto. Se precisar, é só enviar uma nova mensagem!",
      nextStepId: ID.finishInact,
      __rfPos: pos(2000, Y_INACT),
    },
  },

  // ── 20. Finish (inactivity) ──
  {
    id: ID.finishInact,
    type: "finish_conversation",
    config: {
      __rfPos: pos(2300, Y_INACT),
    },
  },
];

async function main() {
  console.log("Creating bot template automation...");

  const orgIdEnv = process.env.SEED_ORG_ID;
  const org = orgIdEnv
    ? await prisma.organization.findUnique({ where: { id: orgIdEnv } })
    : await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    throw new Error(
      "Nenhuma Organization encontrada. Defina SEED_ORG_ID ou crie uma org antes do seed.",
    );
  }
  const organizationId = org.id;

  const automation = await prisma.automation.create({
    data: {
      organizationId,
      name: "Bot Template (baseado em DataCrazy)",
      description:
        "Template de bot de atendimento com menu interativo, submenus, horário comercial, transferência e controle de inatividade. Edite as mensagens conforme sua necessidade.",
      triggerType: "message_received",
      triggerConfig: {},
      active: false,
      steps: {
        create: steps.map((s, index) => ({
          organizationId,
          id: s.id,
          type: s.type,
          config: s.config as Prisma.InputJsonValue,
          position: index,
        })),
      },
    },
    include: { steps: { orderBy: { position: "asc" } } },
  });

  const automationWithSteps = automation as typeof automation & {
    steps: { id: string }[];
  };

  console.log(`Automation created: ${automation.id}`);
  console.log(`  Name: ${automation.name}`);
  console.log(`  Steps: ${automationWithSteps.steps.length}`);
  console.log(`  Active: ${automation.active}`);
  console.log("\nDone! Open the automation in the CRM to edit messages and configure the trigger.");
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
