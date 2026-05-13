/**
 * Catálogo gerado automaticamente a partir dos arquivos `.dc` em `Bots/`.
 * NÃO EDITE À MÃO — rode `npx tsx src/scripts/import-bots-dc.ts` para
 * regenerar. A lista é mesclada em `automation-templates.ts`.
 *
 * Gerado em: 2026-04-20T14:53:37.727Z
 * Bots importados: 10
 *
 * Resumo:
  • export-18173ccf-7df9-41a8-9cf3-7   → Teste                          [12 steps, 7 warn]
  • export-35e0cedf-d245-4d0f-bb52-5   → Bot Bv Leads                   [147 steps, 16 warn]
  • export-5fcbb6a2-8cd7-42eb-9bb5-e   → Encerramento                   [35 steps, 26 warn]
  • export-80523f0b-85c4-4b56-9606-e   → Disparo Prova Simples          [ 8 steps, 6 warn]
  • export-9ba8199c-b34e-44f2-a05a-4   → Msgs Ia                        [ 3 steps, 2 warn]
  • export-9bbae5b2-b6f7-4eef-a230-5   → Oferta Rematricula 1           [ 1 steps, 1 warn]
  • export-ba07ddef-f443-4d1b-9585-5   → Bot Inicio V2                  [150 steps, 16 warn]
  • export-bdaf3fed-bf0e-41fe-bc58-b   → RB - Acesso Gerado (Email E Senha) [25 steps, 8 warn]
  • export-d7e89aad-96f0-4485-86e0-6   → Bot Bv Sem Email               [79 steps, 7 warn]
  • export-ede1b610-5efb-4a45-a21f-5   → Aguardando Resposta            [28 steps, 20 warn]
 */

import {
  HandCoins,
  HeartHandshake,
  Play,
  RefreshCcw,
  Sparkles,
} from "lucide-react";

import type { AutomationTemplate } from "./automation-templates";

// ─────────────────────────────────────────────────────────────
// export-18173ccf-7df9-41a8-9cf3-7eda20cd3ee7-ce96eb1b-0865-4c48-856a-26ddc90cc6e9.dc
// Bot original: "Teste" — 8 blocos
// Steps gerados: 12
// ⚠️ Revisar (7):
//   - Trigger desconhecido: business-entered-trigger — configure manualmente.
//   - Condição desconhecida: field-is-equal-condition
//   - lose-business-action: não há equivalente direto — adicionando tag + finish.
//   - Condição desconhecida: field-is-equal-condition
//   - lose-business-action: não há equivalente direto — adicionando tag + finish.
//   - Condição desconhecida: field-is-equal-condition
//   - lose-business-action: não há equivalente direto — adicionando tag + finish.
// ─────────────────────────────────────────────────────────────
const T_IMPORTED_01: AutomationTemplate = {
  id: "imported-teste-ce96eb1b",
  name: "Teste",
  tagline: "Bot importado — 8 blocos traduzidos.",
  description: "Importado do Digisac (ce96eb1b). ⚠️ 7 ponto(s) a revisar.",
  category: "vendas",
  icon: HandCoins,
  accent: "emerald",
  ready: false,
  setupMinutes: 3,
  automation: {
    name: "Teste",
    description: "Versão adaptada de \"teste\" do Digisac.",
    triggerType: "tag_added",
    triggerConfig: {
      tagName: "Disparar bot",
    },
    steps: [
      {
        id: "tpl_dc_teste_000",
        type: "condition",
        config: {
          path: "field-is-equal-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_teste_001",
        type: "add_tag",
        config: {
          tagName: "Negócio perdido (auto)",
        },
      },
      {
        id: "tpl_dc_teste_002",
        type: "finish",
        config: {
          action: "stop",
        },
      },
      {
        id: "tpl_dc_teste_003",
        type: "add_tag",
        config: {
          tagName: "",
        },
      },
      {
        id: "tpl_dc_teste_004",
        type: "condition",
        config: {
          path: "field-is-equal-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_teste_005",
        type: "add_tag",
        config: {
          tagName: "Negócio perdido (auto)",
        },
      },
      {
        id: "tpl_dc_teste_006",
        type: "finish",
        config: {
          action: "stop",
        },
      },
      {
        id: "tpl_dc_teste_007",
        type: "add_tag",
        config: {
          tagName: "",
        },
      },
      {
        id: "tpl_dc_teste_008",
        type: "condition",
        config: {
          path: "field-is-equal-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_teste_009",
        type: "add_tag",
        config: {
          tagName: "Negócio perdido (auto)",
        },
      },
      {
        id: "tpl_dc_teste_010",
        type: "finish",
        config: {
          action: "stop",
        },
      },
      {
        id: "tpl_dc_teste_011",
        type: "add_tag",
        config: {
          tagName: "",
        },
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// export-35e0cedf-d245-4d0f-bb52-519ea28d2133-eeb47641-497d-4ef1-880d-62e407853e60.dc
// Bot original: "Bot Bv Leads" — 100 blocos
// Steps gerados: 147
// ⚠️ Revisar (16):
//   - stageId original: 3016b9c8-3914-4bf5-8f7c-1fee44baea9c
//   - pipelineId original: 7d1b30e3-b554-4225-8523-d2d21ffc7c35
//   - pipelineId original: 088b64ae-a2ab-4788-97cd-3c10d87643bb
//   - pipelineId original: fae865c0-fa41-449b-95a9-22c0a73f633e
//   - pipelineId original: b067d289-0963-4593-b7f4-307b967230f4
//   - stageId original: 7e89e4a3-09ca-4e5a-976b-35f7f041ccf6
//   - Condição desconhecida: field-contains-condition
//   - stageId original: 7e89e4a3-09ca-4e5a-976b-35f7f041ccf6
//   - pipelineId original: 7d1b30e3-b554-4225-8523-d2d21ffc7c35
//   - stageId original: 742714eb-ac5a-435f-8680-97e6ab8f2f6e
//   - create-lead-action: contato já é criado pelo CRM no WhatsApp — marcamos só com tag.
//   - lose-business-action: não há equivalente direto — adicionando tag + finish.
//   - pipelineId original: 088b64ae-a2ab-4788-97cd-3c10d87643bb
//   - create-lead-action: contato já é criado pelo CRM no WhatsApp — marcamos só com tag.
//   - stageId original: 742714eb-ac5a-435f-8680-97e6ab8f2f6e
//   - pipelineId original: 7d1b30e3-b554-4225-8523-d2d21ffc7c35
// ─────────────────────────────────────────────────────────────
const T_IMPORTED_02: AutomationTemplate = {
  id: "imported-bot-bv-leads-eeb47641",
  name: "Bot Bv Leads",
  tagline: "Olá! Bem vindo ao Suporte ao Aluno *da Cruzeiro do Sul*. 😃",
  description: "Importado do Digisac (eeb47641). ⚠️ 16 ponto(s) a revisar.",
  category: "vendas",
  icon: HandCoins,
  accent: "emerald",
  ready: false,
  setupMinutes: 15,
  automation: {
    name: "Bot Bv Leads",
    description: "Versão adaptada de \"bot_bv_leads\" do Digisac.",
    triggerType: "message_received",
    triggerConfig: {
      channel: "whatsapp",
      _keywords: [],
      _matchType: "contains",
    },
    steps: [
      {
        id: "tpl_dc_bot-bv-leads_000",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "3016b9c8-3914-4bf5-8f7c-1fee44baea9c",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_001",
        type: "condition",
        config: {
          path: "contact.tags",
          op: "includes",
          value: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_002",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "7d1b30e3-b554-4225-8523-d2d21ffc7c35",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_003",
        type: "send_whatsapp_message",
        config: {
          content: "Olá! Bem vindo ao Suporte ao Aluno *da Cruzeiro do Sul*. 😃",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_004",
        type: "question",
        config: {
          message: "Selecione para dar andamento na conversa.",
          buttons: [
            {
              id: "btn_0",
              title: "Como acessar\n",
            },
            {
              id: "btn_1",
              title: "Dúvidas Financeiras",
            },
            {
              id: "btn_2",
              title: "Abertura de Solicita",
            },
            {
              id: "btn_3",
              title: "Falar com atendiment",
            },
            {
              id: "btn_4",
              title: "Acesso a plataforma",
            },
            {
              id: "btn_5",
              title: "Rematrícula",
            },
            {
              id: "btn_6",
              title: "Financeiro",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_005",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_006",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "088b64ae-a2ab-4788-97cd-3c10d87643bb",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_007",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções:",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_008",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "fae865c0-fa41-449b-95a9-22c0a73f633e",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_009",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "b067d289-0963-4593-b7f4-307b967230f4",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_010",
        type: "send_whatsapp_message",
        config: {
          content: "👋Oi, tudo bem?",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_011",
        type: "question",
        config: {
          message: "Não localizei este telefone que estamos conversando em nossa base de dados!\n\nPara continuarmos, por favor *digite* uma das opções abaixo:👇",
          buttons: [
            {
              id: "btn_0",
              title: "Já sou aluno",
            },
            {
              id: "btn_1",
              title: "Quero me matricular",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_012",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_013",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em um dos botões disponíveis:",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_014",
        type: "question",
        config: {
          message: "Clique uma *das opções*:",
          buttons: [
            {
              id: "btn_0",
              title: "Emitir Declarações",
            },
            {
              id: "btn_1",
              title: "Enviar Documentos",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_015",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_016",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções para continuar a conversa, ok? ",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_017",
        type: "send_whatsapp_message",
        config: {
          content: "Pelo aplicativo Duda, clique em *''Aulas e Conteúdo''.*\n\nAo entrar na plataforma, você terá acesso as disciplinas do semestre, *separadas por mês/prazo*.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_018",
        type: "send_whatsapp_message",
        config: {
          content: "Pelo aplicativo Duda, clique em *''Aulas e Conteúdo''.*\n\nAo entrar na plataforma, você terá acesso as disciplinas do semestre, *separadas por mês/prazo*.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_019",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A38%3A51.167Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_020",
        type: "send_whatsapp_message",
        config: {
          content: "Em seu app, vá na opção ''Perfil'' 👉Clique em ''Emitir Documentos''. \n\nNessa seção, você poderá obter tanto declarações acadêmicas quanto financeiras!",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_021",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A41%3A53.069Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_022",
        type: "question",
        config: {
          message: "Certo, agora me informe a *dúvida*:",
          buttons: [
            {
              id: "btn_0",
              title: "Regras de pagamento",
            },
            {
              id: "btn_1",
              title: "Como pagar",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_023",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_024",
        type: "question",
        config: {
          message: "Agora escolha umas das opções:",
          buttons: [
            {
              id: "btn_0",
              title: "Primeiro Acesso",
            },
            {
              id: "btn_1",
              title: "Dúvidas Financeiras",
            },
            {
              id: "btn_2",
              title: "Portal de Estudos",
            },
            {
              id: "btn_3",
              title: "Documentos",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_025",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_026",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_027",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_028",
        type: "send_whatsapp_message",
        config: {
          content: "Essa mensagem foi encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_029",
        type: "question",
        config: {
          message: "Agora escolha umas das opções:",
          buttons: [
            {
              id: "btn_0",
              title: "Primeiro Acesso",
            },
            {
              id: "btn_1",
              title: "Dúvidas Financeiras",
            },
            {
              id: "btn_2",
              title: "Portal de Estudos",
            },
            {
              id: "btn_3",
              title: "Documentos",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_030",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_031",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_032",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_033",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em umas das opções disponíveis:",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_034",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_035",
        type: "move_stage",
        config: {
          stageId: "7e89e4a3-09ca-4e5a-976b-35f7f041ccf6",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_036",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_037",
        type: "condition",
        config: {
          path: "field-contains-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_038",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_039",
        type: "send_whatsapp_message",
        config: {
          content: "Já já um de nossos consultores entra em contato com você 😊\n\nMe conta, por favor, o que você gostaria de conversar ou resolver.\nFique à vontade para explicar da forma que achar mais fácil 💬",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_040",
        type: "send_whatsapp_message",
        config: {
          content: "Certo, nesse caso, como você não é matriculado em nossas unidades, não tenho acesso às suas informações por aqui 🥹.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_041",
        type: "send_whatsapp_message",
        config: {
          content: "Todo o conteúdo de suas disciplinas, assim como atividades e notas obtidas, estão disponíveis no seu *Ambiente Virtual*, também chamado de *BLACKBOARD*.\n",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_042",
        type: "send_whatsapp_message",
        config: {
          content: "Para acessar, entre no seu portal do aluno e clique em \"*AMBIENTE VIRTUAL*\" no canto esquerdo.\n",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_043",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A51%3A28.484Z",
          caption: "Em seguida, vá para \"CURSOS\" e clique na disciplina desejada.\n \nLá você encontrará\nacesso às vídeoaulas e ao material em PDF da disciplina.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_044",
        type: "send_whatsapp_message",
        config: {
          content: "*Em breve um de nossos consultores irá te chamar!*\n\nMe conta, sobre o que você deseja falar?\nPergunte de maneira simples que eu entendo melhor assim. 😊",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_045",
        type: "send_whatsapp_message",
        config: {
          content: "Para enviar seus documentos pelo app Duda, selecione a opção Perfil, em seguida, clique 👉 Meus documentos para anexar.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_046",
        type: "send_whatsapp_message",
        config: {
          content: "Ao tentar enviar, leia as instruções de como encaminhar o documento em questão, ok?\n",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_047",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A44%3A29.790Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_048",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_049",
        type: "send_whatsapp_message",
        config: {
          content: "Pelo *App Duda*, clique em *''Aulas e Conteúdo''.*\n\nAo entrar na plataforma, você terá acesso as disciplinas do semestre, *separadas por mês/prazo*.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_050",
        type: "send_whatsapp_message",
        config: {
          content: "Entrando na matéria, poderá acessar o material de estudo na opção *Conteúdo*, cada unidade terá uma apostila, *uma videoaula e uma atividade valendo nota.*",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_051",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T13%3A35%3A36.413Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_052",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_053",
        type: "question",
        config: {
          message: "Você está tentando acessar pelo *App Duda* ou pela *Área do Aluno*?",
          buttons: [
            {
              id: "btn_0",
              title: "Aplicativo Duda",
            },
            {
              id: "btn_1",
              title: "Área do Aluno (site)",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_054",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_055",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_056",
        type: "send_whatsapp_message",
        config: {
          content: "Caso precise abrir alguma solicitação, acesse sua *Área do aluno* 👉 https://novoportal.cruzeirodosul.edu.br/",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_057",
        type: "send_whatsapp_message",
        config: {
          content: "*1.* Clique na opção *CAA On-line*\n\n*2.* Vá em *Faça sua solicitação*\n\n*3.* Pronto, agora é só selecionar UNICID/CRUZEIRO DO SUL/BRAZ CUBAS e procurar pelo processo desejado.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_058",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A29%3A18.815Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_059",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_060",
        type: "send_whatsapp_message",
        config: {
          content: "*PASSO A PASSO PARA FAZER A REMATRÍCULA*\n\n❗ *Importante:*\nSe houver mensalidades ou boletos em aberto, será necessário regularizar os débitos primeiro.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_061",
        type: "send_whatsapp_message",
        config: {
          content: "Acesse o Portal do Aluno:\nEntre pelo site https://novoportal.cruzeirodosul.edu.br/\nFaça login usando seu e-mail acadêmico e sua senha.\n\nClique em *Rematrícula* no menu inicial.\n\nLeia e aceite o Termo de Rematrícula.\nClique em  *Prosseguir*  para continuar com o processo.\nVerifique se está tudo certo com as informações e clique em *Gravar* .\nAssim que gravar a rematrícula, será gerado automaticamente um boleto da taxa de rematrícula.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_062",
        type: "send_whatsapp_message",
        config: {
          content: "Realize o pagamento do boleto.\nA compensação (baixa) do pagamento ocorre em até *3 a 5 dias úteis* após o pagamento.\n\n*Após a baixa do pagamento:*\nAcesse novamente o portal.\nClique novamente em  *Rematrícula*.\nGrave sua rematrícula mais uma vez.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_063",
        type: "send_whatsapp_message",
        config: {
          content: "*Pronto!* Você estará liberado(a) para acessar suas disciplinas e iniciar os estudos.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_064",
        type: "send_whatsapp_message",
        config: {
          content: "*Em breve um de nossos consultores irá te chamar!*\n\nMe conta, sobre o que você deseja falar?\nPergunte de maneira simples que eu entendo melhor assim. 😊",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_065",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções disponíveis",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_066",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções para continuar a conversa",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_067",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_068",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções para continuar essa conversa!",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_069",
        type: "send_whatsapp_message",
        config: {
          content: "Não encontramos você em nossa *base de alunos*. \n\nPrestamos suporte para as unidades (polos) 👇",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_070",
        type: "send_whatsapp_message",
        config: {
          content: "Barra Funda\nVila Prudente\nVila Mariana\nFreguesia do Ó (Moinho Velho)\nVila Ema (Sapopemba)\nIbirapuera (Indianápolis)\nTaboão da Serra - Jardim Mituzi\nTaboão da Serra - Centro\nCampinas (Ouro Verde) \nItapira (Santo Antônio)\nCapivari (Centro)\nMorumbi (Vila Progedior)\nSantana 2",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_071",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_072",
        type: "move_stage",
        config: {
          stageId: "7e89e4a3-09ca-4e5a-976b-35f7f041ccf6",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_073",
        type: "send_whatsapp_message",
        config: {
          content: "Para pagar suas mensalidades, siga o passo a passo:\n \n1️⃣ Acesse sua *Área do Aluno.*\n2️⃣ Clique em *Pagar Mensalidade*\n3️⃣ Selecione a título *que deseja pagar* (boleto ou cartão)\n \n_obs_ - _Para pagamentos via boleto, o *desconto sempre fica no corpo* do documento e *todos os titulos são gerados no valor bruto*_",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_074",
        type: "send_whatsapp_message",
        config: {
          content: "Assista ao vídeo para *entender como funciona* para pagamentos pelo seu *Portal do Aluno*.\n",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_075",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A23%3A18.860Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_076",
        type: "send_whatsapp_message",
        config: {
          content: "Todo o conteúdo de suas disciplinas, assim como atividades e notas obtidas, estão disponíveis no seu Ambiente Virtual, também chamado de BLACKBOARD.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_077",
        type: "send_whatsapp_message",
        config: {
          content: "Para acessar, entre no seu portal do aluno e clique em \"*AMBIENTE VIRTUAL*\" no canto esquerdo.\n",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_078",
        type: "send_whatsapp_message",
        config: {
          content: "Em seguida, vá para \"CURSOS\" e clique na disciplina desejada. Lá você encontrará\nacesso às vídeoaulas e ao material em PDF da disciplina.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_079",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T13%3A37%3A26.274Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_080",
        type: "send_whatsapp_message",
        config: {
          content: "Para emitir alguma declaração referente ao seu curso, entre na sua *Área do Aluno* 👉clique em *Emissão de Documentos*.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_081",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T15%3A03%3A58.167Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_082",
        type: "question",
        config: {
          message: "Teria mais alguma dúvida?",
          buttons: [
            {
              id: "btn_0",
              title: "Preciso de ajuda",
            },
            {
              id: "btn_1",
              title: "Não!",
            },
            {
              id: "btn_2",
              title: "Voltar para o início",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_083",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_084",
        type: "send_whatsapp_message",
        config: {
          content: "Que bom! \n\nQualquer dúvida é só nos chamar, até mais. 😉",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_085",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "7d1b30e3-b554-4225-8523-d2d21ffc7c35",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_086",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma opção disponível.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_087",
        type: "send_whatsapp_message",
        config: {
          content: "Certo! Para começarmos, por favor *digite*  seu *CPF* completo.\n\n\n*Exemplo*: Se seu CPF for 123.456.789-10 você deverá digitar 12345678910.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_088",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_089",
        type: "send_whatsapp_message",
        config: {
          content: "Entenda *como fiunciona os pagamentos*: \n🔹 *Primeira mensalidade do semestre*:\nA primeira *mensalidade* após a rematrícula ou matrícula *pode ser paga com desconto até o dia 25 do mês*.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_090",
        type: "send_whatsapp_message",
        config: {
          content: "🔹 *Entenda melhor como funciona*:\n \n* *Pagamento até o dia 10*: 25% de desconto\n* *Pagamento até o dia 25*: 15% de desconto\nEssa informação é fornecida durante o *processo de matrícula* e também na *aula de introdução* realizada pelo polo.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_091",
        type: "send_whatsapp_message",
        config: {
          content: "🔹 Desconto nas demais mensalidades:\nPara garantir o desconto total, o pagamento deve ser feito até o dia 10 do mês.\n⚠️ Importante: Se o pagamento não for realizado até o dia 10, o desconto será reduzido.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_092",
        type: "question",
        config: {
          message: "Você matriculado em algum dos polos *acima?*",
          buttons: [
            {
              id: "btn_0",
              title: "Sim",
            },
            {
              id: "btn_1",
              title: "Não",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_093",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_094",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções:",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_095",
        type: "send_whatsapp_message",
        config: {
          content: "Ok! 😉\n\nAguardamos seu contato, tá bom?\nAté mais! 😊",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_096",
        type: "send_whatsapp_message",
        config: {
          content: "Para realizar seu acesso, assista ao vídeo explicativo ☝️\n",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_097",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A34%3A49.876Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_098",
        type: "send_whatsapp_message",
        config: {
          content: "Agora, clique aqui para começar 👉 https://novoportal.cruzeirodosul.edu.br/\n",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_099",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_100",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em um dos botões disponíveis:",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_101",
        type: "send_whatsapp_message",
        config: {
          content: "Essa mensagem foi encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_102",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_103",
        type: "move_stage",
        config: {
          stageId: "742714eb-ac5a-435f-8680-97e6ab8f2f6e",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_104",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_105",
        type: "send_whatsapp_message",
        config: {
          content: "Certo!\n\nEste canal é dedicado ao atendimento dos nossos alunos.\n \nVamos transferir esta conversa para nosso time comercial e em breve, você receberá uma mensagem de um(a) de nossos consultores(as) que vai te orientar e tirar todas as suas dúvidas.😉\nAté mais!",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_106",
        type: "add_tag",
        config: {
          tagName: "Lead do bot Digisac",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_107",
        type: "create_deal",
        config: {
          stageId: "7e89e4a3-09ca-4e5a-976b-35f7f041ccf6",
          title: "Novo negócio",
          value: 0,
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_108",
        type: "add_tag",
        config: {
          tagName: "Negócio perdido (auto)",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_109",
        type: "finish",
        config: {
          action: "stop",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_110",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_111",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_112",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_113",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "088b64ae-a2ab-4788-97cd-3c10d87643bb",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_114",
        type: "question",
        config: {
          message: "Clique uma *das opções*:",
          buttons: [
            {
              id: "btn_0",
              title: "Emitir Declarações",
            },
            {
              id: "btn_1",
              title: "Enviar Documentos",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_115",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_116",
        type: "add_tag",
        config: {
          tagName: "Lead do bot Digisac",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_117",
        type: "create_deal",
        config: {
          stageId: "7e89e4a3-09ca-4e5a-976b-35f7f041ccf6",
          title: "Novo negócio",
          value: 0,
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_118",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/leads_cpf_csv",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "cpf",
              value: "{CPF/CNPJ do lead|leadTaxId}",
            },
            {
              key: "telefone",
              value: "{Telefone do lead|leadPhone}",
            },
            {
              key: "id_lead",
              value: "{ID do lead|leadId}",
            },
            {
              key: "id_negocio",
              value: "{ID do negócio|businessId}",
            },
            {
              key: "Nome",
              value: "{Nome do lead|leadName}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_119",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa será encerrada devido por falta de interação!",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_120",
        type: "question",
        config: {
          message: "Olá! Agradecemos o seu contato.\n\nNo momento, estamos fora do nosso horário de atendimento.\n\nNosso horário de funcionamento é:\n\nSegunda a Sexta-feira: 08h às 20h\n\nSábados: 09h às 14h\n\nSelecione uma das opções abaixo:",
          buttons: [
            {
              id: "btn_0",
              title: "Encerrar",
            },
            {
              id: "btn_1",
              title: "Aguardar horário de ",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_121",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_122",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em um dos botões disponíveis para continuar essa conversa!",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_123",
        type: "send_whatsapp_message",
        config: {
          content: "Dentro do app *Duda*:\n \nClique em *Financeiro* 👉 Selecione a mensalidade desejada 👉 Clique em *Pagar com boleto*",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_124",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A36%3A21.973Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_125",
        type: "business_hours",
        config: {
          schedule: [
            {
              days: [
                1,
                2,
                3,
                4,
                5,
              ],
              from: "09:00",
              to: "18:00",
            },
          ],
          timezone: "America/Sao_Paulo",
          elseStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_126",
        type: "send_whatsapp_message",
        config: {
          content: "Certo! Assim que nossos consultores estiverem disponíveis, daremos início ao seu atendimento.\n\nSe preferir, você pode adiantar sua dúvida ou problema por aqui — assim conseguimos agilizar seu atendimento de forma mais rápida e prática. 😊\n\n_Caso você já tenha informado o motivo do contato, pode desconsiderar esta mensagem. Vamos dar andamento assim que retornarmos ao expediente._",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_127",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa está sendo encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_128",
        type: "business_hours",
        config: {
          schedule: [
            {
              days: [
                1,
                2,
                3,
                4,
                5,
              ],
              from: "09:00",
              to: "18:00",
            },
          ],
          timezone: "America/Sao_Paulo",
          elseStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_129",
        type: "send_whatsapp_message",
        config: {
          content: "Para pagar suas mensalidades, siga o passo a passo;\n \n1️⃣ Acesse sua *Área do Aluno.*\n2️⃣ Clique em *Pagar Mensalidade*\n3️⃣ Selecione a título *que deseja pagar* (boleto ou cartão)\n_obs_ - _Para pagamentos via boleto, o *desconto sempre fica no corpo* do documento e *todos os titulos são gerados no valor bruto*_",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_130",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A49%3A46.534Z",
          caption: "Assista ao vídeo para *entender como funciona* para pagamentos pelo seu *Portal do Aluno*.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_131",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/enviar_comercial",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "telefone_lead",
              value: "{Telefone do lead|leadPhone}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_132",
        type: "move_stage",
        config: {
          stageId: "742714eb-ac5a-435f-8680-97e6ab8f2f6e",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_133",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "7d1b30e3-b554-4225-8523-d2d21ffc7c35",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_134",
        type: "send_whatsapp_message",
        config: {
          content: "Certo. Por favor *aguarde* enquanto localizo as informações em nossa base de dados.⌛",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_135",
        type: "question",
        config: {
          message: "Você está dúvidas em relação a qual *plataforma*?",
          buttons: [
            {
              id: "btn_0",
              title: "Aplicativo Duda",
            },
            {
              id: "btn_1",
              title: "Área do aluno (site)",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_136",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_137",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_138",
        type: "question",
        config: {
          message: "Não entendi, vamos tentar novamente:\n\nVocê matriculado em algum dos polos *acima?*",
          buttons: [
            {
              id: "btn_0",
              title: "Sim",
            },
            {
              id: "btn_1",
              title: "Não",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_139",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_140",
        type: "send_whatsapp_message",
        config: {
          content: "Clique no link abaixo 👇 localize seu polo de apoio e os contatos para conversar *diretamente com sua unidade*:\n\nhttps://www.cruzeirodosulvirtual.com.br/nossos-polos/",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_141",
        type: "send_whatsapp_message",
        config: {
          content: "Este atendimento está sendo encerrado. 😉",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_142",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A48%3A17.456Z",
          caption: "Para realizar seu acesso, assista ao vídeo explicativo ☝️",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_143",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_144",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-leads_145",
        type: "send_whatsapp_message",
        config: {
          content: "1️⃣ Acesse sua *Área do Aluno* clicando em 👉 novoportal.cruzeirodosul.edu.br\n\n2️⃣ Clique na seção *Vida Acadêmica 👉 Documentos Pendentes*\n\n3️⃣​Clique no botão vermelho e envie seu documento de forma legível, *frente e verso em uma única via*.\n⚠️ _A pendência de documentos pode bloquear algumas *solicitações*. Regularize o quanto antes_",
        },
      },
      {
        id: "tpl_dc_bot-bv-leads_146",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T15%3A05%3A11.712Z",
          caption: "",
        },
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// export-5fcbb6a2-8cd7-42eb-9bb5-ea4de4a637f2-c6f2fe92-098a-47aa-a538-867049552b3f.dc
// Bot original: "Encerramento" — 29 blocos
// Steps gerados: 35
// ⚠️ Revisar (26):
//   - Trigger desconhecido: thread-finished-trigger — configure manualmente.
//   - Ação desconhecida: start-conversation-action
//   - pipelineId original: 088b64ae-a2ab-4788-97cd-3c10d87643bb
//   - stageId original: ce42afe6-757f-405c-aa34-6668f4a75d07
//   - pipelineId original: 7d1b30e3-b554-4225-8523-d2d21ffc7c35
//   - stageId original: 3016b9c8-3914-4bf5-8f7c-1fee44baea9c
//   - Ação desconhecida: clean-attendant-on-business-action
//   - Ação desconhecida: change-conversation-attendant-action
//   - Ação desconhecida: clean-attendant-on-lead-action
//   - stageId original: 8ed7b59b-97e7-451d-8a98-bd8bebe47bdc
//   - stageId original: 742714eb-ac5a-435f-8680-97e6ab8f2f6e
//   - stageId original: 0fe0398b-a16d-422f-b8b9-7aad35862661
//   - pipelineId original: 088b64ae-a2ab-4788-97cd-3c10d87643bb
//   - stageId original: ff066cac-c97d-40ab-bfbf-8fef71780461
//   - stageId original: d56d7bf4-4162-4911-9716-5335b32b1b4a
//   - pipelineId original: 16638d55-b556-4792-8e11-f67c04ecf94c
//   - stageId original: 7e89e4a3-09ca-4e5a-976b-35f7f041ccf6
//   - Condição desconhecida: field-is-equal-condition
//   - Condição desconhecida: field-has-value-condition
//   - Condição desconhecida: field-is-equal-condition
//   - Ação desconhecida: remove-tag-action
//   - Ação desconhecida: clean-attendant-on-lead-action
//   - Ação desconhecida: clean-attendant-on-business-action
//   - Ação desconhecida: change-conversation-attendant-action
//   - stageId original: b34d2b09-9853-42a1-902f-5b572622b9e1
//   - stageId original: 742714eb-ac5a-435f-8680-97e6ab8f2f6e
// ─────────────────────────────────────────────────────────────
const T_IMPORTED_03: AutomationTemplate = {
  id: "imported-encerramento-c6f2fe92",
  name: "Encerramento",
  tagline: "Este atendimento foi encerrado, se quiser retornar para convervar novamente conosco, por favor escolha uma das",
  description: "Importado do Digisac (c6f2fe92). ⚠️ 26 ponto(s) a revisar.",
  category: "vendas",
  icon: HandCoins,
  accent: "emerald",
  ready: false,
  setupMinutes: 7,
  automation: {
    name: "Encerramento",
    description: "Versão adaptada de \"Encerramento\" do Digisac.",
    triggerType: "tag_added",
    triggerConfig: {
      tagName: "Disparar bot",
    },
    steps: [
      {
        id: "tpl_dc_encerramento_000",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_encerramento_001",
        type: "set_variable",
        config: {
          variableName: "_digisac_start-conversation-action",
          value: "{\"type\":\"current-conversation\",\"instanceId\":\"\"}",
        },
      },
      {
        id: "tpl_dc_encerramento_002",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_encerramento_003",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_encerramento_004",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "088b64ae-a2ab-4788-97cd-3c10d87643bb",
        },
      },
      {
        id: "tpl_dc_encerramento_005",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "ce42afe6-757f-405c-aa34-6668f4a75d07",
        },
      },
      {
        id: "tpl_dc_encerramento_006",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "7d1b30e3-b554-4225-8523-d2d21ffc7c35",
        },
      },
      {
        id: "tpl_dc_encerramento_007",
        type: "move_stage",
        config: {
          stageId: "3016b9c8-3914-4bf5-8f7c-1fee44baea9c",
        },
      },
      {
        id: "tpl_dc_encerramento_008",
        type: "set_variable",
        config: {
          variableName: "_digisac_clean-attendant-on-business-action",
          value: "{\"cleanAttendantOnLead\":true}",
        },
      },
      {
        id: "tpl_dc_encerramento_009",
        type: "set_variable",
        config: {
          variableName: "_digisac_change-conversation-attendant-action",
          value: "{\"type\":\"all-conversations\",\"instanceId\":\"\",\"attendantId\":\"\"}",
        },
      },
      {
        id: "tpl_dc_encerramento_010",
        type: "set_variable",
        config: {
          variableName: "_digisac_clean-attendant-on-lead-action",
          value: "{\"attendantId\":\"\"}",
        },
      },
      {
        id: "tpl_dc_encerramento_011",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "8ed7b59b-97e7-451d-8a98-bd8bebe47bdc",
        },
      },
      {
        id: "tpl_dc_encerramento_012",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "742714eb-ac5a-435f-8680-97e6ab8f2f6e",
        },
      },
      {
        id: "tpl_dc_encerramento_013",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_encerramento_014",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "0fe0398b-a16d-422f-b8b9-7aad35862661",
        },
      },
      {
        id: "tpl_dc_encerramento_015",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "088b64ae-a2ab-4788-97cd-3c10d87643bb",
        },
      },
      {
        id: "tpl_dc_encerramento_016",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "ff066cac-c97d-40ab-bfbf-8fef71780461",
        },
      },
      {
        id: "tpl_dc_encerramento_017",
        type: "question",
        config: {
          message: "Este atendimento foi encerrado, se quiser retornar para convervar novamente conosco, por favor escolha uma das opções:",
          buttons: [
            {
              id: "btn_0",
              title: "Retornar ao atendime",
            },
            {
              id: "btn_1",
              title: "Encerrar conversa",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_encerramento_018",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_encerramento_019",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções:",
        },
      },
      {
        id: "tpl_dc_encerramento_020",
        type: "move_stage",
        config: {
          stageId: "d56d7bf4-4162-4911-9716-5335b32b1b4a",
        },
      },
      {
        id: "tpl_dc_encerramento_021",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "16638d55-b556-4792-8e11-f67c04ecf94c",
        },
      },
      {
        id: "tpl_dc_encerramento_022",
        type: "move_stage",
        config: {
          stageId: "7e89e4a3-09ca-4e5a-976b-35f7f041ccf6",
        },
      },
      {
        id: "tpl_dc_encerramento_023",
        type: "condition",
        config: {
          path: "field-is-equal-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_encerramento_024",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/feedback_dcz",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "telefone",
              value: "{Telefone do lead|leadPhone}",
            },
            {
              key: "id_lead",
              value: "{ID do lead|leadId}",
            },
            {
              key: "id_negocio",
              value: "{ID do negócio|businessId}",
            },
            {
              key: "conversa",
              value: "{ID da conversa|conversationId}",
            },
            {
              key: "polo",
              value: "{Polo|additional-field[Polo]}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_encerramento_025",
        type: "condition",
        config: {
          path: "field-has-value-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_encerramento_026",
        type: "condition",
        config: {
          path: "field-is-equal-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_encerramento_027",
        type: "send_whatsapp_message",
        config: {
          content: "Obrigado pelo retorno, estamos encerrando esse atendimento. 😉",
        },
      },
      {
        id: "tpl_dc_encerramento_028",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_encerramento_029",
        type: "set_variable",
        config: {
          variableName: "_digisac_remove-tag-action",
          value: "{\"tagIds\":[\"dc34ff2a-154e-4e30-a3d8-169e4cf89c4c\"],\"tagName\":\"\"}",
        },
      },
      {
        id: "tpl_dc_encerramento_030",
        type: "set_variable",
        config: {
          variableName: "_digisac_clean-attendant-on-lead-action",
          value: "{\"attendantId\":\"\"}",
        },
      },
      {
        id: "tpl_dc_encerramento_031",
        type: "set_variable",
        config: {
          variableName: "_digisac_clean-attendant-on-business-action",
          value: "{\"cleanAttendantOnLead\":true}",
        },
      },
      {
        id: "tpl_dc_encerramento_032",
        type: "set_variable",
        config: {
          variableName: "_digisac_change-conversation-attendant-action",
          value: "{\"type\":\"current-conversation\",\"instanceId\":\"\",\"attendantId\":\"\"}",
        },
      },
      {
        id: "tpl_dc_encerramento_033",
        type: "move_stage",
        config: {
          stageId: "b34d2b09-9853-42a1-902f-5b572622b9e1",
        },
      },
      {
        id: "tpl_dc_encerramento_034",
        type: "move_stage",
        config: {
          stageId: "742714eb-ac5a-435f-8680-97e6ab8f2f6e",
        },
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// export-80523f0b-85c4-4b56-9606-e1d94454c48f-57700eb6-43b5-40e0-8299-050b7da35a53.dc
// Bot original: "Disparo Prova Simples" — 9 blocos
// Steps gerados: 8
// ⚠️ Revisar (6):
//   - Trigger desconhecido: business-entered-trigger — configure manualmente.
//   - pipelineId original: fae865c0-fa41-449b-95a9-22c0a73f633e
//   - pipelineId original: fae865c0-fa41-449b-95a9-22c0a73f633e
//   - stageId original: ce604d81-7b66-41ba-8880-ee71d7543cd4
//   - stageId original: d56d7bf4-4162-4911-9716-5335b32b1b4a
//   - Ação desconhecida: remove-tag-action
// ─────────────────────────────────────────────────────────────
const T_IMPORTED_04: AutomationTemplate = {
  id: "imported-disparo-prova-simples-57700eb6",
  name: "Disparo Prova Simples",
  tagline: "Olá, {{1}}! Tudo bem?\n\nEstamos entrando em contato para informar que identificamos *que você possui mensalidad",
  description: "Importado do Digisac (57700eb6). ⚠️ 6 ponto(s) a revisar.",
  category: "vendas",
  icon: HandCoins,
  accent: "emerald",
  ready: false,
  setupMinutes: 3,
  automation: {
    name: "Disparo Prova Simples",
    description: "Versão adaptada de \"disparo_prova_simples\" do Digisac.",
    triggerType: "tag_added",
    triggerConfig: {
      tagName: "Disparar bot",
    },
    steps: [
      {
        id: "tpl_dc_disparo-prova-simples_000",
        type: "send_whatsapp_template",
        config: {
          templateName: "inadimplente_oficial",
          languageCode: "pt_BR",
          _bodyPreview: "Olá, {{1}}! Tudo bem?\n\nEstamos entrando em contato para informar que identificamos *que você possui mensalidade(s) em ab",
          _parameters: "Aluno={{first_name}}",
        },
      },
      {
        id: "tpl_dc_disparo-prova-simples_001",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "fae865c0-fa41-449b-95a9-22c0a73f633e",
        },
      },
      {
        id: "tpl_dc_disparo-prova-simples_002",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "fae865c0-fa41-449b-95a9-22c0a73f633e",
        },
      },
      {
        id: "tpl_dc_disparo-prova-simples_003",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_disparo-prova-simples_004",
        type: "move_stage",
        config: {
          stageId: "ce604d81-7b66-41ba-8880-ee71d7543cd4",
        },
      },
      {
        id: "tpl_dc_disparo-prova-simples_005",
        type: "move_stage",
        config: {
          stageId: "d56d7bf4-4162-4911-9716-5335b32b1b4a",
        },
      },
      {
        id: "tpl_dc_disparo-prova-simples_006",
        type: "condition",
        config: {
          path: "contact.tags",
          op: "includes",
          value: "",
        },
      },
      {
        id: "tpl_dc_disparo-prova-simples_007",
        type: "set_variable",
        config: {
          variableName: "_digisac_remove-tag-action",
          value: "{\"tagIds\":[\"fd9d5b68-ee85-4a4e-8461-42ee67383dea\"],\"tagName\":\"\"}",
        },
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// export-9ba8199c-b34e-44f2-a05a-4cb729f943e9-7f87bb8f-ed6f-476b-b74f-a0acbe0c870b.dc
// Bot original: "Msgs Ia" — 4 blocos
// Steps gerados: 3
// ⚠️ Revisar (2):
//   - pipelineId original: 0710ce8c-ce9d-4fb8-91cd-4c1183399f1c
//   - stageId original: 31029060-891e-42c2-bc89-ab50b4b1c834
// ─────────────────────────────────────────────────────────────
const T_IMPORTED_05: AutomationTemplate = {
  id: "imported-msgs-ia-7f87bb8f",
  name: "Msgs Ia",
  tagline: "Bot importado — 4 blocos traduzidos.",
  description: "Importado do Digisac (7f87bb8f). ⚠️ 2 ponto(s) a revisar.",
  category: "atendimento",
  icon: Sparkles,
  accent: "amber",
  ready: false,
  setupMinutes: 3,
  automation: {
    name: "Msgs Ia",
    description: "Versão adaptada de \"msgs_ia\" do Digisac.",
    triggerType: "message_received",
    triggerConfig: {
      channel: "whatsapp",
      _keywords: [],
      _matchType: "contains",
    },
    steps: [
      {
        id: "tpl_dc_msgs-ia_000",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "0710ce8c-ce9d-4fb8-91cd-4c1183399f1c",
        },
      },
      {
        id: "tpl_dc_msgs-ia_001",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "31029060-891e-42c2-bc89-ab50b4b1c834",
        },
      },
      {
        id: "tpl_dc_msgs-ia_002",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/ia_acesso_portal",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "id_lead",
              value: "{ID do lead|leadId}",
            },
            {
              key: "id_negocio",
              value: "{ID do negócio|businessId}",
            },
            {
              key: "id_conversa",
              value: "{ID da conversa|conversationId}",
            },
            {
              key: "telefone",
              value: "{Telefone do lead|leadPhone}",
            },
          ],
          _body: "",
        },
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// export-9bbae5b2-b6f7-4eef-a230-5a18832a938d-9e7c1d69-af1d-43de-ac96-96fe16bded43.dc
// Bot original: "Oferta Rematricula 1" — 2 blocos
// Steps gerados: 1
// ⚠️ Revisar (1):
//   - Disparo manual no Digisac — ajustamos para tag 'Disparar bot'.
// ─────────────────────────────────────────────────────────────
const T_IMPORTED_06: AutomationTemplate = {
  id: "imported-oferta-rematricula-1-9e7c1d69",
  name: "Oferta Rematricula 1",
  tagline: "🚨 Oi! Aqui é  {{1}}, da Cruzeiro do Sul.\nTô te chamando porque sua rematrícula está liberada e você tem acess",
  description: "Importado do Digisac (9e7c1d69). ⚠️ 1 ponto(s) a revisar.",
  category: "educacional",
  icon: RefreshCcw,
  accent: "cyan",
  ready: false,
  setupMinutes: 3,
  automation: {
    name: "Oferta Rematricula 1",
    description: "Versão adaptada de \"oferta_rematricula_1\" do Digisac.",
    triggerType: "tag_added",
    triggerConfig: {
      tagName: "Disparar bot",
    },
    steps: [
      {
        id: "tpl_dc_oferta-rematricula-1_000",
        type: "send_whatsapp_template",
        config: {
          templateName: "oferta_rematricula_1",
          languageCode: "pt_BR",
          _bodyPreview: "🚨 Oi! Aqui é  {{1}}, da Cruzeiro do Sul.\nTô te chamando porque sua rematrícula está liberada e você tem acesso à campan",
          _parameters: "Felipe={{agent_name}}",
        },
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// export-ba07ddef-f443-4d1b-9585-58ed4f01feb1-d24e4ee3-425e-4230-aa05-54512c465f7f.dc
// Bot original: "Bot Inicio V2" — 101 blocos
// Steps gerados: 150
// ⚠️ Revisar (16):
//   - Disparo manual no Digisac — ajustamos para tag 'Disparar bot'.
//   - stageId original: 3016b9c8-3914-4bf5-8f7c-1fee44baea9c
//   - pipelineId original: 7d1b30e3-b554-4225-8523-d2d21ffc7c35
//   - pipelineId original: 088b64ae-a2ab-4788-97cd-3c10d87643bb
//   - pipelineId original: fae865c0-fa41-449b-95a9-22c0a73f633e
//   - lose-business-action: não há equivalente direto — adicionando tag + finish.
//   - stageId original: 742714eb-ac5a-435f-8680-97e6ab8f2f6e
//   - pipelineId original: 088b64ae-a2ab-4788-97cd-3c10d87643bb
//   - stageId original: 7e89e4a3-09ca-4e5a-976b-35f7f041ccf6
//   - create-lead-action: contato já é criado pelo CRM no WhatsApp — marcamos só com tag.
//   - pipelineId original: 7d1b30e3-b554-4225-8523-d2d21ffc7c35
//   - Condição desconhecida: field-contains-condition
//   - pipelineId original: 7d1b30e3-b554-4225-8523-d2d21ffc7c35
//   - stageId original: 7e89e4a3-09ca-4e5a-976b-35f7f041ccf6
//   - stageId original: 742714eb-ac5a-435f-8680-97e6ab8f2f6e
//   - create-lead-action: contato já é criado pelo CRM no WhatsApp — marcamos só com tag.
// ─────────────────────────────────────────────────────────────
const T_IMPORTED_07: AutomationTemplate = {
  id: "imported-bot-inicio-v2-d24e4ee3",
  name: "Bot Inicio V2",
  tagline: "Olá! Bem vindo ao Suporte ao Aluno *da Cruzeiro do Sul*. 😃",
  description: "Importado do Digisac (d24e4ee3). ⚠️ 16 ponto(s) a revisar.",
  category: "vendas",
  icon: Play,
  accent: "emerald",
  ready: false,
  setupMinutes: 15,
  automation: {
    name: "Bot Inicio V2",
    description: "Versão adaptada de \"bot_inicio_v2\" do Digisac.",
    triggerType: "tag_added",
    triggerConfig: {
      tagName: "Disparar bot",
    },
    steps: [
      {
        id: "tpl_dc_bot-inicio-v2_000",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "3016b9c8-3914-4bf5-8f7c-1fee44baea9c",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_001",
        type: "condition",
        config: {
          path: "contact.tags",
          op: "includes",
          value: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_002",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "7d1b30e3-b554-4225-8523-d2d21ffc7c35",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_003",
        type: "send_whatsapp_message",
        config: {
          content: "Olá! Bem vindo ao Suporte ao Aluno *da Cruzeiro do Sul*. 😃",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_004",
        type: "question",
        config: {
          message: "Selecione para dar andamento na conversa.",
          buttons: [
            {
              id: "btn_0",
              title: "Como acessar\n",
            },
            {
              id: "btn_1",
              title: "Dúvidas Financeiras",
            },
            {
              id: "btn_2",
              title: "Abertura de Solicita",
            },
            {
              id: "btn_3",
              title: "Falar com atendiment",
            },
            {
              id: "btn_4",
              title: "Acesso a plataforma",
            },
            {
              id: "btn_5",
              title: "Rematrícula",
            },
            {
              id: "btn_6",
              title: "Início das Aulas",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_005",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_006",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "088b64ae-a2ab-4788-97cd-3c10d87643bb",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_007",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções:",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_008",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "fae865c0-fa41-449b-95a9-22c0a73f633e",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_009",
        type: "send_whatsapp_message",
        config: {
          content: "👋Oi, tudo bem?",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_010",
        type: "question",
        config: {
          message: "Não localizei este telefone que estamos conversando em nossa base de dados!\n\nPara continuarmos, por favor *digite* uma das opções abaixo:👇",
          buttons: [
            {
              id: "btn_0",
              title: "Já sou aluno",
            },
            {
              id: "btn_1",
              title: "Quero me matricular",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_011",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_012",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em um dos botões disponíveis:",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_013",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_014",
        type: "question",
        config: {
          message: "Você matriculado em algum dos polos *acima?*",
          buttons: [
            {
              id: "btn_0",
              title: "Sim",
            },
            {
              id: "btn_1",
              title: "Não",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_015",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_016",
        type: "send_whatsapp_message",
        config: {
          content: "*Em breve um de nossos consultores irá te chamar!*\n\nMe conta, sobre o que você deseja falar?\nPergunte de maneira simples que eu entendo melhor assim. 😊",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_017",
        type: "send_whatsapp_message",
        config: {
          content: "Certo!\n\nEste canal é dedicado ao atendimento dos nossos alunos.\n \nVamos transferir esta conversa para nosso time comercial e em breve, você receberá uma mensagem de um(a) de nossos consultores(as) que vai te orientar e tirar todas as suas dúvidas.😉\nAté mais!",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_018",
        type: "question",
        config: {
          message: "Agora escolha umas das opções:",
          buttons: [
            {
              id: "btn_0",
              title: "Primeiro Acesso",
            },
            {
              id: "btn_1",
              title: "Dúvidas Financeiras",
            },
            {
              id: "btn_2",
              title: "Portal de Estudos",
            },
            {
              id: "btn_3",
              title: "Documentos",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_019",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_020",
        type: "add_tag",
        config: {
          tagName: "Negócio perdido (auto)",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_021",
        type: "finish",
        config: {
          action: "stop",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_022",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_023",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em um dos botões disponíveis para continuar essa conversa!",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_024",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_025",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_026",
        type: "question",
        config: {
          message: "Agora escolha umas das opções:",
          buttons: [
            {
              id: "btn_0",
              title: "Primeiro Acesso",
            },
            {
              id: "btn_1",
              title: "Dúvidas Financeiras",
            },
            {
              id: "btn_2",
              title: "Portal de Estudos",
            },
            {
              id: "btn_3",
              title: "Documentos",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_027",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_028",
        type: "send_whatsapp_message",
        config: {
          content: "Essa mensagem foi encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_029",
        type: "send_whatsapp_message",
        config: {
          content: "Certo! Assim que nossos consultores estiverem disponíveis, daremos início ao seu atendimento.\n\nSe preferir, você pode adiantar sua dúvida ou problema por aqui — assim conseguimos agilizar seu atendimento de forma mais rápida e prática. 😊\n\n_Caso você já tenha informado o motivo do contato, pode desconsiderar esta mensagem. Vamos dar andamento assim que retornarmos ao expediente._",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_030",
        type: "question",
        config: {
          message: "Você está dúvidas em relação a qual *plataforma*?",
          buttons: [
            {
              id: "btn_0",
              title: "Aplicativo Duda",
            },
            {
              id: "btn_1",
              title: "Área do aluno (site)",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_031",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_032",
        type: "send_whatsapp_message",
        config: {
          content: "1️⃣ Acesse sua *Área do Aluno* clicando em 👉 novoportal.cruzeirodosul.edu.br\n\n2️⃣ Clique na seção *Vida Acadêmica 👉 Documentos Pendentes*\n\n3️⃣​Clique no botão vermelho e envie seu documento de forma legível, *frente e verso em uma única via*.\n⚠️ _A pendência de documentos pode bloquear algumas *solicitações*. Regularize o quanto antes_",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_033",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T15%3A05%3A11.712Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_034",
        type: "move_stage",
        config: {
          stageId: "742714eb-ac5a-435f-8680-97e6ab8f2f6e",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_035",
        type: "question",
        config: {
          message: "Não entendi, vamos tentar novamente:\n\nVocê matriculado em algum dos polos *acima?*",
          buttons: [
            {
              id: "btn_0",
              title: "Sim",
            },
            {
              id: "btn_1",
              title: "Não",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_036",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_037",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/enviar_comercial",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "telefone_lead",
              value: "{Telefone do lead|leadPhone}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_038",
        type: "send_whatsapp_message",
        config: {
          content: "Certo, nesse caso, como você não é matriculado em nossas unidades, não tenho acesso às suas informações por aqui 🥹.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_039",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_040",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_041",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma opção disponível.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_042",
        type: "send_whatsapp_message",
        config: {
          content: "Todo o conteúdo de suas disciplinas, assim como atividades e notas obtidas, estão disponíveis no seu *Ambiente Virtual*, também chamado de *BLACKBOARD*.\n",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_043",
        type: "send_whatsapp_message",
        config: {
          content: "Para acessar, entre no seu portal do aluno e clique em \"*AMBIENTE VIRTUAL*\" no canto esquerdo.\n",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_044",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A51%3A28.484Z",
          caption: "Em seguida, vá para \"CURSOS\" e clique na disciplina desejada.\n \nLá você encontrará\nacesso às vídeoaulas e ao material em PDF da disciplina.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_045",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções para continuar essa conversa!",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_046",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "088b64ae-a2ab-4788-97cd-3c10d87643bb",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_047",
        type: "send_whatsapp_message",
        config: {
          content: "Todo o conteúdo de suas disciplinas, assim como atividades e notas obtidas, estão disponíveis no seu Ambiente Virtual, também chamado de BLACKBOARD.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_048",
        type: "send_whatsapp_message",
        config: {
          content: "Para acessar, entre no seu portal do aluno e clique em \"*AMBIENTE VIRTUAL*\" no canto esquerdo.\n",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_049",
        type: "send_whatsapp_message",
        config: {
          content: "Em seguida, vá para \"CURSOS\" e clique na disciplina desejada. Lá você encontrará\nacesso às vídeoaulas e ao material em PDF da disciplina.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_050",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T13%3A37%3A26.274Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_051",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_052",
        type: "move_stage",
        config: {
          stageId: "7e89e4a3-09ca-4e5a-976b-35f7f041ccf6",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_053",
        type: "send_whatsapp_message",
        config: {
          content: "Certo! Para começarmos, por favor *digite*  seu *CPF* completo.\n\n\n*Exemplo*: Se seu CPF for 123.456.789-10 você deverá digitar 12345678910.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_054",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_055",
        type: "send_whatsapp_message",
        config: {
          content: "Caso esteja no app *Duda*:\nClique em *Financeiro* 👉 Selecione a mensalidade desejada 👉 Clique em *Pagar com boleto*",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_056",
        type: "send_whatsapp_message",
        config: {
          content: "Caso esteja no app *Duda*:\n \nClique em *Financeiro* 👉 Selecione a mensalidade desejada 👉 Clique em *Pagar com boleto*",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_057",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A24%3A39.254Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_058",
        type: "question",
        config: {
          message: "Olá! Agradecemos o seu contato.\n\nNo momento, estamos fora do nosso horário de atendimento.\n\nNosso horário de funcionamento é:\n\nSegunda a Sexta-feira: 08h às 20h\n\nSábados: 09h às 14h\n\nSelecione uma das opções abaixo:",
          buttons: [
            {
              id: "btn_0",
              title: "Encerrar",
            },
            {
              id: "btn_1",
              title: "Aguardar horário de ",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_059",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_060",
        type: "send_whatsapp_message",
        config: {
          content: "Pelo aplicativo Duda, clique em *''Aulas e Conteúdo''.*\n\nAo entrar na plataforma, você terá acesso as disciplinas do semestre, *separadas por mês/prazo*.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_061",
        type: "send_whatsapp_message",
        config: {
          content: "Pelo aplicativo Duda, clique em *''Aulas e Conteúdo''.*\n\nAo entrar na plataforma, você terá acesso as disciplinas do semestre, *separadas por mês/prazo*.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_062",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A38%3A51.167Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_063",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa está sendo encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_064",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_065",
        type: "add_tag",
        config: {
          tagName: "Lead do bot Digisac",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_066",
        type: "create_deal",
        config: {
          stageId: "7e89e4a3-09ca-4e5a-976b-35f7f041ccf6",
          title: "Novo negócio",
          value: 0,
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_067",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em umas das opções disponíveis:",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_068",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/ia_acesso_portal",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "id_lead",
              value: "{ID do lead|leadId}",
            },
            {
              key: "id_negocio",
              value: "{ID do negócio|businessId}",
            },
            {
              key: "telefone",
              value: "{Telefone do lead|leadPhone}",
            },
            {
              key: "id_conversa",
              value: "{ID da conversa|conversationId}",
            },
            {
              key: "id_mensagem",
              value: "{Código da conversa|threadCode}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_069",
        type: "question",
        config: {
          message: "Certo, agora me informe a *dúvida*:",
          buttons: [
            {
              id: "btn_0",
              title: "Regras de pagamento",
            },
            {
              id: "btn_1",
              title: "Como pagar",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_070",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_071",
        type: "question",
        config: {
          message: "Você está tentando acessar pelo *App Duda* ou pela *Área do Aluno*?",
          buttons: [
            {
              id: "btn_0",
              title: "Aplicativo Duda",
            },
            {
              id: "btn_1",
              title: "Área do Aluno (site)",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_072",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_073",
        type: "business_hours",
        config: {
          schedule: [
            {
              days: [
                1,
                2,
                3,
                4,
                5,
              ],
              from: "09:00",
              to: "18:00",
            },
          ],
          timezone: "America/Sao_Paulo",
          elseStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_074",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/leads_cpf_csv",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "cpf",
              value: "{CPF/CNPJ do lead|leadTaxId}",
            },
            {
              key: "telefone",
              value: "{Telefone do lead|leadPhone}",
            },
            {
              key: "id_lead",
              value: "{ID do lead|leadId}",
            },
            {
              key: "id_negocio",
              value: "{ID do negócio|businessId}",
            },
            {
              key: "Nome",
              value: "{Nome do lead|leadName}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_075",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_076",
        type: "send_whatsapp_message",
        config: {
          content: "Para pagar suas mensalidades, siga o passo a passo:\n \n1️⃣ Acesse sua *Área do Aluno.*\n2️⃣ Clique em *Pagar Mensalidade*\n3️⃣ Selecione a título *que deseja pagar* (boleto ou cartão)\n \n_obs_ - _Para pagamentos via boleto, o *desconto sempre fica no corpo* do documento e *todos os titulos são gerados no valor bruto*_",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_077",
        type: "send_whatsapp_message",
        config: {
          content: "Assista ao vídeo para *entender como funciona* para pagamentos pelo seu *Portal do Aluno*.\n",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_078",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A23%3A18.860Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_079",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções:",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_080",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_081",
        type: "send_whatsapp_message",
        config: {
          content: "Essa mensagem foi encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_082",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_083",
        type: "send_whatsapp_message",
        config: {
          content: "Entenda *como fiunciona os pagamentos*: \n🔹 *Primeira mensalidade do semestre*:\nA primeira *mensalidade* após a rematrícula ou matrícula *pode ser paga com desconto até o dia 25 do mês*.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_084",
        type: "send_whatsapp_message",
        config: {
          content: "🔹 *Entenda melhor como funciona*:\n \n* *Pagamento até o dia 10*: 25% de desconto\n* *Pagamento até o dia 25*: 15% de desconto\nEssa informação é fornecida durante o *processo de matrícula* e também na *aula de introdução* realizada pelo polo.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_085",
        type: "send_whatsapp_message",
        config: {
          content: "🔹 Desconto nas demais mensalidades:\nPara garantir o desconto total, o pagamento deve ser feito até o dia 10 do mês.\n⚠️ Importante: Se o pagamento não for realizado até o dia 10, o desconto será reduzido.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_086",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_087",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_088",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_089",
        type: "send_whatsapp_message",
        config: {
          content: "Não encontramos você em nossa *base de alunos*. \n\nPrestamos suporte para as unidades (polos) 👇",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_090",
        type: "send_whatsapp_message",
        config: {
          content: "Barra Funda\nVila Prudente\nVila Mariana\nFreguesia do Ó (Moinho Velho)\nVila Ema (Sapopemba)\nIbirapuera (Indianápolis)\nTaboão da Serra - Jardim Mituzi\nTaboão da Serra - Centro\nCampinas (Ouro Verde) \nItapira (Santo Antônio)\nCapivari (Centro)\nMorumbi (Vila Progedior)\nSantana 2",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_091",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_092",
        type: "send_whatsapp_message",
        config: {
          content: "Para enviar seus documentos pelo app Duda, selecione a opção Perfil, em seguida, clique 👉 Meus documentos para anexar.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_093",
        type: "send_whatsapp_message",
        config: {
          content: "Ao tentar enviar, leia as instruções de como encaminhar o documento em questão, ok?\n",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_094",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A44%3A29.790Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_095",
        type: "question",
        config: {
          message: "Teria mais alguma dúvida?",
          buttons: [
            {
              id: "btn_0",
              title: "Preciso de ajuda",
            },
            {
              id: "btn_1",
              title: "Não!",
            },
            {
              id: "btn_2",
              title: "Voltar para o início",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_096",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_097",
        type: "send_whatsapp_message",
        config: {
          content: "Em seu app, vá na opção ''Perfil'' 👉Clique em ''Emitir Documentos''. \n\nNessa seção, você poderá obter tanto declarações acadêmicas quanto financeiras!",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_098",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A41%3A53.069Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_099",
        type: "send_whatsapp_message",
        config: {
          content: "Para realizar seu acesso, assista ao vídeo explicativo ☝️\n",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_100",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A34%3A49.876Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_101",
        type: "send_whatsapp_message",
        config: {
          content: "Agora, clique aqui para começar 👉 https://novoportal.cruzeirodosul.edu.br/\n",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_102",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_103",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "7d1b30e3-b554-4225-8523-d2d21ffc7c35",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_104",
        type: "condition",
        config: {
          path: "field-contains-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_105",
        type: "send_whatsapp_message",
        config: {
          content: "Que bom! \n\nQualquer dúvida é só nos chamar, até mais. 😉",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_106",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_107",
        type: "send_whatsapp_message",
        config: {
          content: "Caso precise abrir alguma solicitação, acesse sua *Área do aluno* 👉 https://novoportal.cruzeirodosul.edu.br/",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_108",
        type: "send_whatsapp_message",
        config: {
          content: "*1.* Clique na opção *CAA On-line*\n\n*2.* Vá em *Faça sua solicitação*\n\n*3.* Pronto, agora é só selecionar UNICID/CRUZEIRO DO SUL/BRAZ CUBAS e procurar pelo processo desejado.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_109",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A29%3A18.815Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_110",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_111",
        type: "send_whatsapp_message",
        config: {
          content: "Pelo *App Duda*, clique em *''Aulas e Conteúdo''.*\n\nAo entrar na plataforma, você terá acesso as disciplinas do semestre, *separadas por mês/prazo*.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_112",
        type: "send_whatsapp_message",
        config: {
          content: "Entrando na matéria, poderá acessar o material de estudo na opção *Conteúdo*, cada unidade terá uma apostila, *uma videoaula e uma atividade valendo nota.*",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_113",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T13%3A35%3A36.413Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_114",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções disponíveis",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_115",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções para continuar a conversa",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_116",
        type: "business_hours",
        config: {
          schedule: [
            {
              days: [
                1,
                2,
                3,
                4,
                5,
              ],
              from: "09:00",
              to: "18:00",
            },
          ],
          timezone: "America/Sao_Paulo",
          elseStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_117",
        type: "send_whatsapp_message",
        config: {
          content: "Já já um de nossos consultores entra em contato com você 😊\n\nMe conta, por favor, o que você gostaria de conversar ou resolver.\nFique à vontade para explicar da forma que achar mais fácil 💬",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_118",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "7d1b30e3-b554-4225-8523-d2d21ffc7c35",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_119",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A48%3A17.456Z",
          caption: "Para realizar seu acesso, assista ao vídeo explicativo ☝️",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_120",
        type: "question",
        config: {
          message: "Clique uma *das opções*:",
          buttons: [
            {
              id: "btn_0",
              title: "Emitir Declarações",
            },
            {
              id: "btn_1",
              title: "Enviar Documentos",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_121",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_122",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções para continuar a conversa, ok? ",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_123",
        type: "send_whatsapp_message",
        config: {
          content: "Ok! 😉\n\nAguardamos seu contato, tá bom?\nAté mais! 😊",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_124",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em um dos botões disponíveis:",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_125",
        type: "send_whatsapp_message",
        config: {
          content: "Para pagar suas mensalidades, siga o passo a passo;\n \n1️⃣ Acesse sua *Área do Aluno.*\n2️⃣ Clique em *Pagar Mensalidade*\n3️⃣ Selecione a título *que deseja pagar* (boleto ou cartão)\n_obs_ - _Para pagamentos via boleto, o *desconto sempre fica no corpo* do documento e *todos os titulos são gerados no valor bruto*_",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_126",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A49%3A46.534Z",
          caption: "Assista ao vídeo para *entender como funciona* para pagamentos pelo seu *Portal do Aluno*.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_127",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_128",
        type: "move_stage",
        config: {
          stageId: "7e89e4a3-09ca-4e5a-976b-35f7f041ccf6",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_129",
        type: "send_whatsapp_message",
        config: {
          content: "Certo. Por favor *aguarde* enquanto localizo as informações em nossa base de dados.⌛",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_130",
        type: "move_stage",
        config: {
          stageId: "742714eb-ac5a-435f-8680-97e6ab8f2f6e",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_131",
        type: "send_whatsapp_message",
        config: {
          content: "Dentro do app *Duda*:\n \nClique em *Financeiro* 👉 Selecione a mensalidade desejada 👉 Clique em *Pagar com boleto*",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_132",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T14%3A36%3A21.973Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_133",
        type: "send_whatsapp_message",
        config: {
          content: "Clique no link abaixo 👇 localize seu polo de apoio e os contatos para conversar *diretamente com sua unidade*:\n\nhttps://www.cruzeirodosulvirtual.com.br/nossos-polos/",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_134",
        type: "send_whatsapp_message",
        config: {
          content: "Este atendimento está sendo encerrado. 😉",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_135",
        type: "send_whatsapp_message",
        config: {
          content: "Para emitir alguma declaração referente ao seu curso, entre na sua *Área do Aluno* 👉clique em *Emissão de Documentos*.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_136",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-03T15%3A03%3A58.167Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_137",
        type: "add_tag",
        config: {
          tagName: "Lead do bot Digisac",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_138",
        type: "create_deal",
        config: {
          stageId: "7e89e4a3-09ca-4e5a-976b-35f7f041ccf6",
          title: "Novo negócio",
          value: 0,
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_139",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-inicio-v2_140",
        type: "send_whatsapp_message",
        config: {
          content: "*Em breve um de nossos consultores irá te chamar!*\n\nMe conta, sobre o que você deseja falar?\nPergunte de maneira simples que eu entendo melhor assim. 😊",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_141",
        type: "question",
        config: {
          message: "Clique uma *das opções*:",
          buttons: [
            {
              id: "btn_0",
              title: "Emitir Declarações",
            },
            {
              id: "btn_1",
              title: "Enviar Documentos",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_142",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_143",
        type: "send_whatsapp_message",
        config: {
          content: "*PASSO A PASSO PARA FAZER A REMATRÍCULA*\n\n❗ *Importante:*\nSe houver mensalidades ou boletos em aberto, será necessário regularizar os débitos primeiro.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_144",
        type: "send_whatsapp_message",
        config: {
          content: "Acesse o Portal do Aluno:\nEntre pelo site https://novoportal.cruzeirodosul.edu.br/\nFaça login usando seu e-mail acadêmico e sua senha.\n\nClique em *Rematrícula* no menu inicial.\n\nLeia e aceite o Termo de Rematrícula.\nClique em  *Prosseguir*  para continuar com o processo.\nVerifique se está tudo certo com as informações e clique em *Gravar* .\nAssim que gravar a rematrícula, será gerado automaticamente um boleto da taxa de rematrícula.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_145",
        type: "send_whatsapp_message",
        config: {
          content: "Realize o pagamento do boleto.\nA compensação (baixa) do pagamento ocorre em até *3 a 5 dias úteis* após o pagamento.\n\n*Após a baixa do pagamento:*\nAcesse novamente o portal.\nClique novamente em  *Rematrícula*.\nGrave sua rematrícula mais uma vez.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_146",
        type: "send_whatsapp_message",
        config: {
          content: "*Pronto!* Você estará liberado(a) para acessar suas disciplinas e iniciar os estudos.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_147",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_148",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa será encerrada devido por falta de interação!",
        },
      },
      {
        id: "tpl_dc_bot-inicio-v2_149",
        type: "finish_conversation",
        config: {},
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// export-bdaf3fed-bf0e-41fe-bc58-bbcec4783746-e6efcb30-0d88-4054-a4c6-2c3d8fa180e5.dc
// Bot original: "RB - Acesso Gerado (Email E Senha)" — 18 blocos
// Steps gerados: 25
// ⚠️ Revisar (8):
//   - Trigger desconhecido: business-entered-trigger — configure manualmente.
//   - Condição desconhecida: field-has-value-condition
//   - Condição desconhecida: field-has-value-condition
//   - pipelineId original: fae865c0-fa41-449b-95a9-22c0a73f633e
//   - stageId original: b34d2b09-9853-42a1-902f-5b572622b9e1
//   - stageId original: 742714eb-ac5a-435f-8680-97e6ab8f2f6e
//   - stageId original: b34d2b09-9853-42a1-902f-5b572622b9e1
//   - pipelineId original: fae865c0-fa41-449b-95a9-22c0a73f633e
// ─────────────────────────────────────────────────────────────
const T_IMPORTED_08: AutomationTemplate = {
  id: "imported-rb-acesso-gerado-email-e-senha-e6efcb30",
  name: "RB - Acesso Gerado (Email E Senha)",
  tagline: "Seu acesso foi criado! Para receber suas credenciais, clique no botão abaixo 👇",
  description: "Importado do Digisac (e6efcb30). ⚠️ 8 ponto(s) a revisar.",
  category: "vendas",
  icon: Sparkles,
  accent: "emerald",
  ready: false,
  setupMinutes: 5,
  automation: {
    name: "RB - Acesso Gerado (Email E Senha)",
    description: "Versão adaptada de \"RB - Acesso Gerado (Email e Senha)\" do Digisac.",
    triggerType: "tag_added",
    triggerConfig: {
      tagName: "Disparar bot",
    },
    steps: [
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_000",
        type: "condition",
        config: {
          path: "field-has-value-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_001",
        type: "condition",
        config: {
          path: "field-has-value-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_002",
        type: "send_whatsapp_template",
        config: {
          templateName: "dados_acesso",
          languageCode: "pt_BR",
          _bodyPreview: "Seu acesso foi criado! Para receber suas credenciais, clique no botão abaixo 👇",
          _parameters: "",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_003",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_004",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/acolhimento1",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "Id do Lead",
              value: "{ID do lead|leadId}",
            },
            {
              key: "Id do Negocio",
              value: "{ID do negócio|businessId}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_005",
        type: "question",
        config: {
          message: "Clique no botão para receber seus dados de acesso à plataforma.",
          buttons: [
            {
              id: "btn_0",
              title: "Fazer acesso",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_006",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_007",
        type: "send_whatsapp_message",
        config: {
          content: "Você selecionou uma opção inválida, vamos tentar novamente?",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_008",
        type: "send_whatsapp_message",
        config: {
          content: "Anote suas credenciais 👇\n\n✉ *E-mail*:{E-mail AD|additional-field[E-mail AD]}\n✏´*Senha*: {Senha Provisória|additional-field[Senha Provisória]}",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_009",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "fae865c0-fa41-449b-95a9-22c0a73f633e",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_010",
        type: "send_whatsapp_message",
        config: {
          content: "*Que bom*! \n\nCaso precise de alguma ajuda, é só nos chamar por aqui😀\n\nEsta conversa está sendo encerrada.",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_011",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_012",
        type: "move_stage",
        config: {
          stageId: "b34d2b09-9853-42a1-902f-5b572622b9e1",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_013",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-26T19%3A07%3A47.704Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_014",
        type: "question",
        config: {
          message: "Assista ao tutorial para entender melhor! 😊",
          buttons: [
            {
              id: "btn_0",
              title: "Preciso de ajuda",
            },
            {
              id: "btn_1",
              title: "Consegui entender!",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_015",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_016",
        type: "move_stage",
        config: {
          stageId: "742714eb-ac5a-435f-8680-97e6ab8f2f6e",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_017",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções disponíveis:",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_018",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/acolhimento1",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "id do lead",
              value: "{ID do lead|leadId}",
            },
            {
              key: "id do negocio",
              value: "{ID do negócio|businessId}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_019",
        type: "send_whatsapp_message",
        config: {
          content: "*Em breve um de nossos consultores irá te chamar!*\n\nMe conta, sobre o que você deseja falar?\nPergunte de maneira simples que eu entendo melhor assim. 😊",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_020",
        type: "send_whatsapp_message",
        config: {
          content: "",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_021",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_022",
        type: "move_stage",
        config: {
          stageId: "b34d2b09-9853-42a1-902f-5b572622b9e1",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_023",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "fae865c0-fa41-449b-95a9-22c0a73f633e",
        },
      },
      {
        id: "tpl_dc_rb-acesso-gerado-email-e-senha_024",
        type: "send_whatsapp_template",
        config: {
          templateName: "sem_resposta_dados_de_acesso",
          languageCode: "pt_BR",
          _bodyPreview: "📌 Encerramento automático da conversa\n\nNenhuma nova mensagem foi recebida nas últimas 24 horas, então o atendimento foi",
          _parameters: "",
        },
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// export-d7e89aad-96f0-4485-86e0-6e4d11db0e76-68091a9f-6991-4136-87f5-71d10610dfd7.dc
// Bot original: "Bot Bv Sem Email" — 54 blocos
// Steps gerados: 79
// ⚠️ Revisar (7):
//   - stageId original: 742714eb-ac5a-435f-8680-97e6ab8f2f6e
//   - pipelineId original: 088b64ae-a2ab-4788-97cd-3c10d87643bb
//   - pipelineId original: b067d289-0963-4593-b7f4-307b967230f4
//   - Condição desconhecida: field-has-value-condition
//   - Condição desconhecida: field-has-value-condition
//   - Condição desconhecida: field-has-value-condition
//   - stageId original: b34d2b09-9853-42a1-902f-5b572622b9e1
// ─────────────────────────────────────────────────────────────
const T_IMPORTED_09: AutomationTemplate = {
  id: "imported-bot-bv-sem-email-68091a9f",
  name: "Bot Bv Sem Email",
  tagline: "⭐ Seja muito bem-vindo(a) à Cruzeiro do Sul! ⭐\n\nQue bom ter você aqui! A partir de agora, este é o *seu canal ",
  description: "Importado do Digisac (68091a9f). ⚠️ 7 ponto(s) a revisar.",
  category: "vendas",
  icon: Sparkles,
  accent: "emerald",
  ready: false,
  setupMinutes: 14,
  automation: {
    name: "Bot Bv Sem Email",
    description: "Versão adaptada de \"bot_bv_sem_email\" do Digisac.",
    triggerType: "deal_created",
    triggerConfig: {
      pipelineId: "",
    },
    steps: [
      {
        id: "tpl_dc_bot-bv-sem-email_000",
        type: "send_whatsapp_template",
        config: {
          templateName: "automacao_acolhimento",
          languageCode: "pt_BR",
          _bodyPreview: "⭐ Seja muito bem-vindo(a) à Cruzeiro do Sul! ⭐\n\nQue bom ter você aqui! A partir de agora, este é o *seu canal oficial de",
          _parameters: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_001",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_002",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/interacaoacademico",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "id_lead",
              value: "{ID do lead|leadId}",
            },
            {
              key: "id do negocio",
              value: "{ID do negócio|businessId}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_003",
        type: "send_whatsapp_template",
        config: {
          templateName: "confirmacao_de_matricula_utility",
          languageCode: "pt_BR",
          _bodyPreview: "Olá, este é um aviso de que sua matrícula foi confirmada em nosso sistema. Para receber seus dados de acesso, pedimos qu",
          _parameters: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_004",
        type: "question",
        config: {
          message: "Veja as opções disponíveis! ",
          buttons: [
            {
              id: "btn_0",
              title: "Acessar portal",
            },
            {
              id: "btn_1",
              title: "Falar com suporte",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_005",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_006",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em um dos botões para continuar essa conversa!\n",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_007",
        type: "send_whatsapp_message",
        config: {
          content: "*Seu e-mail de acesso é*: {E-mail AD|additional-field[E-mail AD]}\n\n📌 *Senha inicial*: {Senha Provisória|additional-field[Senha Provisória]}",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_008",
        type: "send_whatsapp_message",
        config: {
          content: "Veja o tutorial de primeiro acesso ao portal 👇",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_009",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-11-27T01%3A37%3A37.559Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_010",
        type: "question",
        config: {
          message: "Conseguiu entender as explicações?",
          buttons: [
            {
              id: "btn_0",
              title: "Sim! Tudo certo",
            },
            {
              id: "btn_1",
              title: "Preciso de ajuda ",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_011",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_012",
        type: "send_whatsapp_message",
        config: {
          content: "Para pagar suas mensalidades, siga o passo a passo:\n\n1️⃣ Clique em Financeiro\n\n2️⃣ Selecione a mensalidade desejada\n3️⃣ Clique em Pagar com boleto\n\n\n💡 Importante: Para pagamentos via boleto, o desconto sempre fica no corpo do documento e todos os titulos são gerados no valor bruto",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_013",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-10-29T16%3A45%3A52.746Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_014",
        type: "send_whatsapp_message",
        config: {
          content: "Certo, é importante que você já saiba suas credenciais para acessar seu portal do aluno, ok? ",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_015",
        type: "move_stage",
        config: {
          stageId: "742714eb-ac5a-435f-8680-97e6ab8f2f6e",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_016",
        type: "send_whatsapp_message",
        config: {
          content: "O vencimento é fixo e, infelizmente, não conseguimos fazer alterações nessa data. Ele é definido automaticamente no ato da matrícula.",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_017",
        type: "send_whatsapp_message",
        config: {
          content: "📢 Regras de Desconto na Mensalidade\n💰 Primeira mensalidade (Matrícula ou Rematrícula):  ➡️ Pode ser paga com desconto até o dia 25 do mês.",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_018",
        type: "send_whatsapp_message",
        config: {
          content: "💰 Demais mensalidades:  ➡️ Para garantir o desconto total, o pagamento deve ser feito até o dia 10 de cada mês.\n🔹 Entenda como funciona:  ✅ Pagamento até o dia 10: 25% de desconto  ✅ Pagamento até o dia 25: 15% de desconto",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_019",
        type: "send_whatsapp_message",
        config: {
          content: "📌 Exemplo:\nSe sua mensalidade for de R$ 200,00:\n🔹 Pagando até o dia 10, você paga R$ 150,00 (25% de desconto).\n🔹 Pagando entre os dias 11 e 25, você paga R$ 170,00 (15% de desconto).\n🔹 Após o dia 25, o valor integral de R$ 200,00 será cobrado.",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_020",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa está sendo encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_021",
        type: "send_whatsapp_message",
        config: {
          content: "*Em breve um de nossos consultores irá te chamar!*\n\nMe conta, sobre o que você deseja falar?\n\nPergunte de maneira simples que eu entendo melhor assim. 😊",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_022",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa foi encerrada devido a falta de interação. ",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_023",
        type: "question",
        config: {
          message: "Veja as opções disponíveis para entender melhor sobre seu curso:",
          buttons: [
            {
              id: "btn_0",
              title: "Acesso ao Portal!",
            },
            {
              id: "btn_1",
              title: "Financeiro ",
            },
            {
              id: "btn_2",
              title: "Entrega de Documento",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_024",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_025",
        type: "send_whatsapp_message",
        config: {
          content: "Para continuar a conversa, clique em um dos botões:",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_026",
        type: "send_whatsapp_message",
        config: {
          content: "Para enviar seus documentos pelo app Duda, selecione a opção Perfil, em seguida, clique 👉 Meus documentos para anexar.",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_027",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-10-29T16%3A56%3A52.697Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_028",
        type: "question",
        config: {
          message: "Qual plataforma você está usando para acessar? _(Se estiver usando pelo celular, recomendamos baixar o app do Duda)_",
          buttons: [
            {
              id: "btn_0",
              title: "Portal (computador)",
            },
            {
              id: "btn_1",
              title: "App Duda (celular)",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_029",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_030",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-sem-email_031",
        type: "add_tag",
        config: {
          tagName: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_032",
        type: "send_whatsapp_message",
        config: {
          content: "Para pagar suas mensalidades, siga o passo a passo:\n\n1️⃣ Acesse sua Área do Aluno.\n2️⃣ Clique em Pagar Mensalidade\n3️⃣ Selecione a título que deseja pagar (boleto ou cartão)\n\n💡 Importante: Para pagamentos via boleto, o desconto sempre fica no corpo do documento e todos os titulos são gerados no valor bruto",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_033",
        type: "send_whatsapp_message",
        config: {
          content: "Assista ao nosso tutorial de pagamento pelo computador ☝️",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_034",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-10-29T16%3A45%3A01.558Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_035",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "088b64ae-a2ab-4788-97cd-3c10d87643bb",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_036",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções disponíveis!",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_037",
        type: "send_whatsapp_message",
        config: {
          content: "Assista ao nosso video tutorial de primeiro acesso ☝️",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_038",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-10-29T16%3A32%3A15.209Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_039",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "b067d289-0963-4593-b7f4-307b967230f4",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_040",
        type: "send_whatsapp_message",
        config: {
          content: "Seu e-mail de acesso — que é sua chave de entrada nas plataformas — *será gerado em breve* e pode ficar pronto a *qualquer momento*. 👉 Por isso, *acompanhe seu e-mail* e fique de olho nas notificações! Assim que tudo estiver disponível, *você poderá acessar seu portal e conferir as disciplinas.*",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_041",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/interacaoacademico",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "id_lead",
              value: "{ID do lead|leadId}",
            },
            {
              key: "id do negocio",
              value: "{ID do negócio|businessId}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_042",
        type: "send_whatsapp_message",
        config: {
          content: "Por favor, clique em uma das opções disponíveis:",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_043",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa está sendo encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_044",
        type: "send_whatsapp_message",
        config: {
          content: "Se precisar, é só nos chamar novamente por aqui!",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_045",
        type: "send_whatsapp_message",
        config: {
          content: "Acesse pelo portal, basta acessar 👉 https://novoportal.cruzeirodosul.edu.br  ➡ Vida Acadêmica  ➡ Entrega de Documentos\n \n📝 Atenção: O site aceita somente arquivos de até 1MB!",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_046",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-sem-email_047",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções para continuar esse atendimento.",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_048",
        type: "condition",
        config: {
          path: "field-has-value-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_049",
        type: "condition",
        config: {
          path: "field-has-value-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_050",
        type: "condition",
        config: {
          path: "field-has-value-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_051",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções disponíveis:",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_052",
        type: "move_stage",
        config: {
          stageId: "b34d2b09-9853-42a1-902f-5b572622b9e1",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_053",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa será encerrada devido a falta de interação.",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_054",
        type: "send_whatsapp_message",
        config: {
          content: "Qualquer dúvida é só nos chamar novamente!",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_055",
        type: "send_whatsapp_message",
        config: {
          content: "Para acessar o portal pela primeira vez, basta seguir o passo a passo:",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_056",
        type: "send_whatsapp_message",
        config: {
          content: "1️⃣ Acesse: https://novoportal.cruzeirodosul.edu.br/\n\n2️⃣ Selecione \"Ensino Superior\"\n3️⃣ Escolha Cruzeiro do Sul Virtual\n\n4️⃣ Clique em \"Não sei meu e-mail acadêmico\" \n5️⃣ Em \"Recuperar e-mail\", digite seu CPF e RGM e clique em Continuar\n\n🔹 Anote seu e-mail acadêmico! Você precisará dele depois.",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_057",
        type: "send_whatsapp_message",
        config: {
          content: "✅ Agora, volte para a página inicial e faça login:\n\n✉️ E-mail: Seu e-mail acadêmico \n\n🔑 Senha padrão: ➡ 3 primeiras letras do seu nome + @ + 3 primeiros números do RGM + 4 primeiros números do CPF\n\n🔄 Após entrar, você poderá criar uma nova senha.",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_058",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/interacaoacademico",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "id_lead",
              value: "{ID do lead|leadId}",
            },
            {
              key: "id do negocio",
              value: "{ID do negócio|businessId}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_059",
        type: "send_whatsapp_message",
        config: {
          content: "Esperamos ter ajudado! Qualquer dúvida, estamos por aqui. 📲\nConte com a gente para te apoiar na sua jornada acadêmica! 🎓🚀",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_060",
        type: "question",
        config: {
          message: "Selecione uma das opções:",
          buttons: [
            {
              id: "btn_0",
              title: "Regras de Vencimento",
            },
            {
              id: "btn_1",
              title: "Pagamento",
            },
            {
              id: "btn_2",
              title: "Aleterar Datas\n",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_061",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_062",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/interacaoacademico",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "id_lead",
              value: "{ID do lead|leadId}",
            },
            {
              key: "id do negocio",
              value: "{ID do negócio|businessId}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_063",
        type: "send_whatsapp_template",
        config: {
          templateName: "automacao_acolhimento2",
          languageCode: "pt_BR",
          _bodyPreview: "Olá! Suas instruções e o acesso ao curso na Cruzeiro do Sul estão te esperando! 🌟 Para darmos o próximo passo e te envi",
          _parameters: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_064",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_065",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-sem-email_066",
        type: "question",
        config: {
          message: "Qual plataforma você está usando para acessar? (Se estiver usando pelo celular, recomendamos baixar o app do Duda)",
          buttons: [
            {
              id: "btn_0",
              title: "Portal (computador)\n",
            },
            {
              id: "btn_1",
              title: "App Duda (celular)",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_067",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_068",
        type: "send_whatsapp_message",
        config: {
          content: "Assista ao nosso video tutorial de primeiro acesso 👇",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_069",
        type: "send_whatsapp_media",
        config: {
          mediaType: "document",
          mediaUrl: "https://dc-qqqq2222pb.s3.amazonaws.com/8485d386-ecbe-4f26-a98d-6026d21a0c70/flow-attachments/8485d386-ecbe-4f26-a98d-6026d21a0c70_2025-10-29T16%3A37%3A50.770Z",
          caption: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_070",
        type: "question",
        config: {
          message: "Qual plataforma você está usando para acessar? _(Se estiver usando pelo celular, recomendamos baixar o app do Duda)_",
          buttons: [
            {
              id: "btn_0",
              title: "Portal (computador)",
            },
            {
              id: "btn_1",
              title: "App Duda (celular)",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_071",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_072",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-sem-email_073",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-sem-email_074",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_bot-bv-sem-email_075",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em um dos botões para *continuar com o atendimento*.",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_076",
        type: "webhook",
        config: {
          url: "https://n8n-new-n8n.ca31ey.easypanel.host/webhook/acolhimento2",
          method: "POST",
          _headers: [],
          _query: [
            {
              key: "id_lead",
              value: "{ID do lead|leadId}",
            },
            {
              key: "id_negocio",
              value: "{ID do negócio|businessId}",
            },
            {
              key: "telefone",
              value: "{Telefone do lead|leadPhone}",
            },
          ],
          _body: "",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_077",
        type: "send_whatsapp_message",
        config: {
          content: "Essa conversa está sendo encerrada. \n\nAté mais!",
        },
      },
      {
        id: "tpl_dc_bot-bv-sem-email_078",
        type: "send_whatsapp_message",
        config: {
          content: "Clique em uma das opções para continuar a conversa:",
        },
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// export-ede1b610-5efb-4a45-a21f-5791eb3c956b-16342126-7d89-4613-b0f6-7d3c5d162f8a.dc
// Bot original: "Aguardando Resposta" — 23 blocos
// Steps gerados: 28
// ⚠️ Revisar (20):
//   - Trigger desconhecido: message-sended-trigger — configure manualmente.
//   - stageId original: 8ed7b59b-97e7-451d-8a98-bd8bebe47bdc
//   - Condição desconhecida: field-is-equal-condition
//   - stageId original: ff066cac-c97d-40ab-bfbf-8fef71780461
//   - stageId original: ce42afe6-757f-405c-aa34-6668f4a75d07
//   - Condição desconhecida: field-is-equal-condition
//   - stageId original: d56d7bf4-4162-4911-9716-5335b32b1b4a
//   - stageId original: b34d2b09-9853-42a1-902f-5b572622b9e1
//   - Ação desconhecida: clean-attendant-on-lead-action
//   - Ação desconhecida: clean-attendant-on-business-action
//   - Ação desconhecida: change-conversation-attendant-action
//   - pipelineId original: 088b64ae-a2ab-4788-97cd-3c10d87643bb
//   - stageId original: ff066cac-c97d-40ab-bfbf-8fef71780461
//   - stageId original: ce42afe6-757f-405c-aa34-6668f4a75d07
//   - pipelineId original: 088b64ae-a2ab-4788-97cd-3c10d87643bb
//   - pipelineId original: 088b64ae-a2ab-4788-97cd-3c10d87643bb
//   - stageId original: 7e89e4a3-09ca-4e5a-976b-35f7f041ccf6
//   - lose-business-action: não há equivalente direto — adicionando tag + finish.
//   - Ação desconhecida: start-conversation-action
//   - pipelineId original: 088b64ae-a2ab-4788-97cd-3c10d87643bb
// ─────────────────────────────────────────────────────────────
const T_IMPORTED_10: AutomationTemplate = {
  id: "imported-aguardando-resposta-16342126",
  name: "Aguardando Resposta",
  tagline: "💬 Oi! Tudo bem?\nPercebi que você não respondeu mais — então vou encerrar esta conversa por aqui, tá?\nSe ainda",
  description: "Importado do Digisac (16342126). ⚠️ 20 ponto(s) a revisar.",
  category: "pos-venda",
  icon: HeartHandshake,
  accent: "violet",
  ready: false,
  setupMinutes: 6,
  automation: {
    name: "Aguardando Resposta",
    description: "Versão adaptada de \"Aguardando Resposta\" do Digisac.",
    triggerType: "tag_added",
    triggerConfig: {
      tagName: "Disparar bot",
    },
    steps: [
      {
        id: "tpl_dc_aguardando-resposta_000",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_001",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "8ed7b59b-97e7-451d-8a98-bd8bebe47bdc",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_002",
        type: "condition",
        config: {
          path: "field-is-equal-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_003",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "ff066cac-c97d-40ab-bfbf-8fef71780461",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_004",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "ce42afe6-757f-405c-aa34-6668f4a75d07",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_005",
        type: "condition",
        config: {
          path: "field-is-equal-condition",
          op: "eq",
          value: "",
          _unsupported: true,
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_006",
        type: "move_stage",
        config: {
          stageId: "d56d7bf4-4162-4911-9716-5335b32b1b4a",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_007",
        type: "move_stage",
        config: {
          stageId: "b34d2b09-9853-42a1-902f-5b572622b9e1",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_008",
        type: "set_variable",
        config: {
          variableName: "_digisac_clean-attendant-on-lead-action",
          value: "{\"attendantId\":\"\"}",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_009",
        type: "set_variable",
        config: {
          variableName: "_digisac_clean-attendant-on-business-action",
          value: "{\"cleanAttendantOnLead\":false}",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_010",
        type: "set_variable",
        config: {
          variableName: "_digisac_change-conversation-attendant-action",
          value: "{\"type\":\"current-conversation\",\"instanceId\":\"\",\"attendantId\":\"\"}",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_011",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "088b64ae-a2ab-4788-97cd-3c10d87643bb",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_012",
        type: "send_whatsapp_message",
        config: {
          content: "💬 Oi! Tudo bem?\nPercebi que você não respondeu mais — então vou encerrar esta conversa por aqui, tá?\nSe ainda precisar de ajuda, é só mandar uma mensagem que retomamos o atendimento rapidinho. 😉",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_013",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "ff066cac-c97d-40ab-bfbf-8fef71780461",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_014",
        type: "condition",
        config: {
          path: "deal.stageId",
          op: "eq",
          value: "ce42afe6-757f-405c-aa34-6668f4a75d07",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_015",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "088b64ae-a2ab-4788-97cd-3c10d87643bb",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_016",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "088b64ae-a2ab-4788-97cd-3c10d87643bb",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_017",
        type: "move_stage",
        config: {
          stageId: "7e89e4a3-09ca-4e5a-976b-35f7f041ccf6",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_018",
        type: "add_tag",
        config: {
          tagName: "Negócio perdido (auto)",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_019",
        type: "finish",
        config: {
          action: "stop",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_020",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_aguardando-resposta_021",
        type: "question",
        config: {
          message: "Oi! 👋\nNão tive retorno seu nos últimos 60 minutos.\nPosso te ajudar com mais alguma coisa?\nSe não for mais necessário, é só selecionar *Encerrar*. 😊\n\n_Caso não haja resposta, o atendimento será encerrado automaticamente em 5 minutos._",
          buttons: [
            {
              id: "btn_0",
              title: "Encerrar",
            },
            {
              id: "btn_1",
              title: "Preciso de ajuda",
            },
          ],
          saveToVariable: "lastResponse",
          timeoutMs: 86400000,
          timeoutAction: "continue",
          timeoutGotoStepId: "",
          elseGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_022",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_023",
        type: "wait_for_reply",
        config: {
          timeoutMs: 86400000,
          receivedGotoStepId: "",
          timeoutGotoStepId: "",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_024",
        type: "set_variable",
        config: {
          variableName: "_digisac_start-conversation-action",
          value: "{\"type\":\"current-conversation\",\"instanceId\":\"\"}",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_025",
        type: "condition",
        config: {
          path: "deal.pipelineId",
          op: "eq",
          value: "088b64ae-a2ab-4788-97cd-3c10d87643bb",
        },
      },
      {
        id: "tpl_dc_aguardando-resposta_026",
        type: "finish_conversation",
        config: {},
      },
      {
        id: "tpl_dc_aguardando-resposta_027",
        type: "send_whatsapp_message",
        config: {
          content: "Muito obrigado por falar com a gente! 💬\nEspero que tenha conseguido te ajudar hoje.\nEncerrando esta conversa por aqui, mas se precisar, é só chamar. 😉",
        },
      },
    ],
  },
};

export const IMPORTED_AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  T_IMPORTED_01,
  T_IMPORTED_02,
  T_IMPORTED_03,
  T_IMPORTED_04,
  T_IMPORTED_05,
  T_IMPORTED_06,
  T_IMPORTED_07,
  T_IMPORTED_08,
  T_IMPORTED_09,
  T_IMPORTED_10,
];
