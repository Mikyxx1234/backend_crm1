/**
 * Generates SQL INSERT statements for the bot template automation.
 * Run: npx tsx src/scripts/seed-bot-template-sql.ts > /tmp/seed-bot.sql
 */

const automationId = "tpl_bot_datacrazy_v1";

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
};

const Y_MAIN = 300;
const Y_OFF = 80;
const Y_RETRY = 520;
const Y_SUB_B = 140;
const Y_OPT2 = 520;
const Y_OPT3 = 680;
const Y_TRANSFER = 560;
const Y_INACT = 700;

type Step = { id: string; type: string; config: Record<string, unknown> };

const steps: Step[] = [
  {
    id: ID.bizHours,
    type: "business_hours",
    config: {
      schedule: [{ days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" }],
      timezone: "America/Sao_Paulo",
      elseStepId: ID.offHoursMsg,
      nextStepId: ID.greeting,
      __rfPos: { x: 200, y: Y_MAIN },
    },
  },
  {
    id: ID.offHoursMsg,
    type: "send_whatsapp_message",
    config: {
      content: "Olá! Nosso horário de atendimento é de segunda a sexta, das 9h às 18h. Deixe sua mensagem que retornaremos assim que possível. 🕐",
      nextStepId: ID.offHoursFinish,
      __rfPos: { x: 500, y: Y_OFF },
    },
  },
  {
    id: ID.offHoursFinish,
    type: "finish_conversation",
    config: { __rfPos: { x: 800, y: Y_OFF } },
  },
  {
    id: ID.greeting,
    type: "send_whatsapp_message",
    config: {
      content: "Olá! Bem-vindo ao nosso atendimento virtual. Como posso ajudá-lo hoje?",
      nextStepId: ID.mainMenu,
      __rfPos: { x: 500, y: Y_MAIN },
    },
  },
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
      timeoutMs: 300000,
      timeoutAction: "goto",
      timeoutGotoStepId: ID.inactivity,
      saveToVariable: "menuChoice",
      __rfPos: { x: 800, y: Y_MAIN },
    },
  },
  {
    id: ID.retryMain,
    type: "send_whatsapp_message",
    config: {
      content: "Desculpe, não entendi sua resposta. Por favor, escolha uma das opções abaixo.",
      nextStepId: ID.mainMenu,
      __rfPos: { x: 800, y: Y_RETRY },
    },
  },
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
      timeoutMs: 300000,
      timeoutAction: "goto",
      timeoutGotoStepId: ID.inactivity,
      saveToVariable: "subChoice",
      __rfPos: { x: 1100, y: Y_MAIN },
    },
  },
  {
    id: ID.retrySub1,
    type: "send_whatsapp_message",
    config: {
      content: "Não entendi. Escolha uma das opções, por favor.",
      nextStepId: ID.subMenu1,
      __rfPos: { x: 1100, y: Y_RETRY },
    },
  },
  {
    id: ID.content1A,
    type: "send_whatsapp_message",
    config: {
      content: "[Conteúdo do Assunto A — edite esta mensagem com as informações desejadas.]",
      nextStepId: ID.hub,
      __rfPos: { x: 1400, y: Y_MAIN },
    },
  },
  {
    id: ID.content1B,
    type: "send_whatsapp_message",
    config: {
      content: "[Conteúdo do Assunto B — edite esta mensagem com as informações desejadas.]",
      nextStepId: ID.hub,
      __rfPos: { x: 1400, y: Y_SUB_B },
    },
  },
  {
    id: ID.content2,
    type: "send_whatsapp_message",
    config: {
      content: "[Conteúdo sobre Serviços — edite esta mensagem com as informações desejadas.]",
      nextStepId: ID.hub,
      __rfPos: { x: 1100, y: Y_OPT2 },
    },
  },
  {
    id: ID.content3,
    type: "send_whatsapp_message",
    config: {
      content: "[Conteúdo sobre Suporte — edite esta mensagem com as informações desejadas.]",
      nextStepId: ID.hub,
      __rfPos: { x: 1100, y: Y_OPT3 },
    },
  },
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
      timeoutMs: 300000,
      timeoutAction: "goto",
      timeoutGotoStepId: ID.inactivity,
      saveToVariable: "hubChoice",
      __rfPos: { x: 1700, y: Y_MAIN },
    },
  },
  {
    id: ID.retryHub,
    type: "send_whatsapp_message",
    config: {
      content: "Não entendi. Escolha uma das opções abaixo, por favor.",
      nextStepId: ID.hub,
      __rfPos: { x: 1700, y: Y_RETRY },
    },
  },
  {
    id: ID.goodbye,
    type: "send_whatsapp_message",
    config: {
      content: "Obrigado pelo contato! Se precisar de algo mais, é só enviar uma mensagem. Até logo! 😊",
      nextStepId: ID.finishAll,
      __rfPos: { x: 2000, y: Y_MAIN },
    },
  },
  {
    id: ID.finishAll,
    type: "finish_conversation",
    config: { __rfPos: { x: 2300, y: Y_MAIN } },
  },
  {
    id: ID.transfer,
    type: "send_whatsapp_message",
    config: {
      content: "Estou transferindo você para um atendente humano. Aguarde um momento, por favor.",
      nextStepId: ID.moveStage,
      __rfPos: { x: 2000, y: Y_TRANSFER },
    },
  },
  {
    id: ID.moveStage,
    type: "move_stage",
    config: { stageId: "", __rfPos: { x: 2300, y: Y_TRANSFER } },
  },
  {
    id: ID.inactivity,
    type: "send_whatsapp_message",
    config: {
      content: "Parece que você ficou inativo. Estou encerrando a conversa por enquanto. Se precisar, é só enviar uma nova mensagem!",
      nextStepId: ID.finishInact,
      __rfPos: { x: 2000, y: Y_INACT },
    },
  },
  {
    id: ID.finishInact,
    type: "finish_conversation",
    config: { __rfPos: { x: 2300, y: Y_INACT } },
  },
];

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

const now = new Date().toISOString();

const lines: string[] = [];

lines.push(`-- Bot Template Seed (DataCrazy-inspired)`);
lines.push(`-- Generated: ${now}`);
lines.push(``);

lines.push(`INSERT INTO "automations" ("id", "name", "description", "triggerType", "triggerConfig", "active", "createdAt", "updatedAt")`);
lines.push(`VALUES (`);
lines.push(`  '${automationId}',`);
lines.push(`  '${esc("Bot Template (baseado em DataCrazy)")}',`);
lines.push(`  '${esc("Template de bot de atendimento com menu interativo, submenus, horário comercial, transferência e controle de inatividade. Edite as mensagens conforme sua necessidade.")}',`);
lines.push(`  'message_received',`);
lines.push(`  '{}',`);
lines.push(`  false,`);
lines.push(`  '${now}',`);
lines.push(`  '${now}'`);
lines.push(`);`);
lines.push(``);

for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  const configJson = esc(JSON.stringify(s.config));
  lines.push(`INSERT INTO "automation_steps" ("id", "type", "config", "position", "automationId")`);
  lines.push(`VALUES ('${s.id}', '${s.type}', '${configJson}', ${i}, '${automationId}');`);
}

lines.push(``);
lines.push(`-- Done: 1 automation + ${steps.length} steps`);

console.log(lines.join("\n"));
