/**
 * Testes do roteamento de ramos na RETOMADA de automações
 * (`automation-context.ts`): resposta do cliente e timeout.
 *
 * Regressão coberta — incidente INICIO-PIPE (Cruzeiro EaD, 03/ago/26): o
 * fallback linear `steps[index + 1]` era aplicado mesmo em automações
 * desenhadas no canvas. Como `automation.steps` é ordenado por `position`
 * (ordem de CRIAÇÃO no editor, não do fluxo), o timeout de um menu de
 * botões pulava pro passo do RAMO VIZINHO — o bot mandou vídeo/link e
 * moveu o lead pra "Em Atendimento" sem o cliente ter clicado em nada.
 */
import { describe, expect, it } from "vitest";

import {
  hasExplicitEdges,
  linearFallbackStepId,
  readStepRef,
} from "@/services/automation-context";

/** Recorte fiel da automação "inicio - pipe" que expôs o bug. */
const INICIO_PIPE_STEPS = [
  {
    id: "step0-boas-vindas",
    config: { nextStepId: "step2-menu", __hasExplicitEdges: true },
  },
  {
    id: "step1-distribuicao",
    config: { nextStepId: "step6-consultor", __hasExplicitEdges: true },
  },
  {
    // Menu principal: timeout desenhado no canvas aponta pro encerramento,
    // mas `timeoutAction` não foi gravado pelo editor.
    id: "step2-menu",
    config: {
      nextStepId: "step3-video",
      elseGotoStepId: "step19-repetir-menu",
      timeoutGotoStepId: "step22-encerrar-inatividade",
      timeoutMs: 900_000,
      __hasExplicitEdges: true,
      buttons: [
        { title: "Acesso a Plataforma", gotoStepId: "step3-video" },
        { title: "Financeiro", gotoStepId: "step12-financeiro" },
        { title: "Falar com equipe", gotoStepId: "step1-distribuicao" },
      ],
    },
  },
  {
    id: "step3-video",
    config: { nextStepId: "step4-link", __hasExplicitEdges: true },
  },
  {
    id: "step4-link",
    config: { nextStepId: "step5-mais-duvidas", __hasExplicitEdges: true },
  },
  {
    id: "step5-mais-duvidas",
    config: {
      nextStepId: "__none__",
      elseGotoStepId: "step21-repetir-duvidas",
      timeoutGotoStepId: "step22-encerrar-inatividade",
      timeoutMs: 900_000,
      __hasExplicitEdges: true,
      buttons: [
        { title: "Preciso de ajuda", gotoStepId: "step1-distribuicao" },
        { title: "Não!", gotoStepId: "step9-despedida" },
        { title: "Voltar para o início", gotoStepId: "step2-menu" },
      ],
    },
  },
  {
    id: "step6-consultor",
    config: { nextStepId: "step7-move-stage", __hasExplicitEdges: true },
  },
  {
    id: "step22-encerrar-inatividade",
    config: { nextStepId: "step23-finish-conversa", __hasExplicitEdges: true },
  },
];

describe("readStepRef", () => {
  it("lê a referência quando preenchida", () => {
    expect(readStepRef({ timeoutGotoStepId: "step22" }, "timeoutGotoStepId")).toBe(
      "step22",
    );
  });

  it("trata string vazia como ausente", () => {
    expect(readStepRef({ timeoutGotoStepId: "" }, "timeoutGotoStepId")).toBeNull();
  });

  it("trata o marcador __none__ (fim de ramo do canvas) como ausente", () => {
    expect(readStepRef({ nextStepId: "__none__" }, "nextStepId")).toBeNull();
  });

  it("ignora tipos não-string e configs inválidos", () => {
    expect(readStepRef({ nextStepId: 42 }, "nextStepId")).toBeNull();
    expect(readStepRef(null, "nextStepId")).toBeNull();
    expect(readStepRef("nao-e-objeto", "nextStepId")).toBeNull();
  });
});

describe("hasExplicitEdges", () => {
  it("detecta steps desenhados no canvas", () => {
    expect(hasExplicitEdges({ __hasExplicitEdges: true })).toBe(true);
  });

  it("steps legados (pré-canvas) não têm o marcador", () => {
    expect(hasExplicitEdges({})).toBe(false);
    expect(hasExplicitEdges({ __hasExplicitEdges: false })).toBe(false);
    expect(hasExplicitEdges(null)).toBe(false);
  });
});

describe("linearFallbackStepId", () => {
  it("BLOQUEIA o fallback linear em steps com arestas explícitas", () => {
    // Este é o coração do bug: sem a guarda, o timeout do menu (position 2)
    // caía em "step3-video" (position 3), que é o ramo "Acesso a Plataforma".
    expect(linearFallbackStepId(INICIO_PIPE_STEPS, "step2-menu")).toBeNull();
    expect(linearFallbackStepId(INICIO_PIPE_STEPS, "step5-mais-duvidas")).toBeNull();
  });

  it("permite o fallback linear em automações legadas", () => {
    const legacy = [
      { id: "a", config: {} },
      { id: "b", config: {} },
      { id: "c", config: {} },
    ];
    expect(linearFallbackStepId(legacy, "a")).toBe("b");
    expect(linearFallbackStepId(legacy, "b")).toBe("c");
  });

  it("devolve null no último step de um fluxo legado", () => {
    const legacy = [
      { id: "a", config: {} },
      { id: "b", config: {} },
    ];
    expect(linearFallbackStepId(legacy, "b")).toBeNull();
  });

  it("devolve null quando o step não existe mais na automação", () => {
    expect(linearFallbackStepId(INICIO_PIPE_STEPS, "step-apagado")).toBeNull();
  });
});

describe("roteamento de timeout — regressão INICIO-PIPE", () => {
  /**
   * Reproduz a decisão de `processTimeout` para `question` /
   * `send_whatsapp_interactive`: aresta desenhada tem prioridade sobre
   * `timeoutAction`, e o fallback linear só vale em fluxos legados.
   */
  function resolveTimeoutTarget(
    steps: { id: string; config: unknown }[],
    currentStepId: string,
  ): string | null {
    const step = steps.find((s) => s.id === currentStepId);
    return (
      readStepRef(step?.config, "timeoutGotoStepId") ??
      linearFallbackStepId(steps, currentStepId)
    );
  }

  it("segue timeoutGotoStepId mesmo sem timeoutAction:'goto' gravado", () => {
    expect(resolveTimeoutTarget(INICIO_PIPE_STEPS, "step2-menu")).toBe(
      "step22-encerrar-inatividade",
    );
  });

  it("não vaza para o ramo vizinho da array (bug original)", () => {
    // Antes da correção o resultado era "step3-video" (ramo "Acesso a
    // Plataforma") no primeiro timeout e "step6-consultor" (ramo "Falar
    // com equipe") no segundo.
    expect(resolveTimeoutTarget(INICIO_PIPE_STEPS, "step2-menu")).not.toBe(
      "step3-video",
    );
    expect(resolveTimeoutTarget(INICIO_PIPE_STEPS, "step5-mais-duvidas")).not.toBe(
      "step6-consultor",
    );
  });

  it("ambos os menus do fluxo convergem para o encerramento por inatividade", () => {
    expect(resolveTimeoutTarget(INICIO_PIPE_STEPS, "step5-mais-duvidas")).toBe(
      "step22-encerrar-inatividade",
    );
  });

  it("encerra o fluxo quando o canvas não conectou a aresta de timeout", () => {
    const semTimeout = [
      {
        id: "menu",
        config: { __hasExplicitEdges: true, buttons: [{ title: "A", gotoStepId: "x" }] },
      },
      { id: "ramo-vizinho", config: { __hasExplicitEdges: true } },
    ];
    expect(resolveTimeoutTarget(semTimeout, "menu")).toBeNull();
  });
});

describe("roteamento de botão — botão válido sem aresta conectada", () => {
  /**
   * Reproduz a decisão de `processIncomingMessage` quando o cliente
   * escolhe uma opção do menu: aresta do botão → saída padrão do passo →
   * saída "nenhuma opção". Clicar certo nunca pode ser tratado como
   * resposta inválida.
   */
  function resolveButtonTarget(
    config: Record<string, unknown>,
    resposta: string,
  ): string | null {
    const buttons = (config.buttons ?? []) as {
      title?: string;
      text?: string;
      id?: string;
      gotoStepId?: string;
    }[];
    const normalized = resposta.trim().toLowerCase();
    const matched = buttons.find((b) => {
      const label = (b.title || b.text || "").trim().toLowerCase();
      const btnId = (b.id || "").trim().toLowerCase();
      return label === normalized || btnId === normalized;
    });
    const elseGoto = readStepRef(config, "elseGotoStepId");
    const defaultOut = readStepRef(config, "nextStepId");
    if (matched) {
      return readStepRef(matched, "gotoStepId") ?? defaultOut ?? elseGoto;
    }
    return elseGoto;
  }

  /** Recorte real de "Follow-up de envio de vaga" (Dna Work), passo pos 7. */
  const MOTIVO_SAIDA = {
    __hasExplicitEdges: true,
    nextStepId: "ee610fcb-encerramento",
    elseGotoStepId: "",
    timeoutGotoStepId: "",
    buttons: [
      { title: "✅ Consegui um emprego", gotoStepId: "" },
      { title: "⏸️ Vou pausar a busca por ora", gotoStepId: "ee610fcb-encerramento" },
      { title: "🐢 O processo demorou muito", gotoStepId: "ee610fcb-encerramento" },
    ],
  };

  it("botão conectado segue a própria aresta", () => {
    expect(resolveButtonTarget(MOTIVO_SAIDA, "⏸️ Vou pausar a busca por ora")).toBe(
      "ee610fcb-encerramento",
    );
  });

  it("botão SEM aresta herda a saída padrão do passo (não fica órfão)", () => {
    expect(resolveButtonTarget(MOTIVO_SAIDA, "✅ Consegui um emprego")).toBe(
      "ee610fcb-encerramento",
    );
  });

  it("o match de botão é case-insensitive e tolera espaços", () => {
    expect(resolveButtonTarget(MOTIVO_SAIDA, "  ⏸️ VOU PAUSAR A BUSCA POR ORA  ")).toBe(
      "ee610fcb-encerramento",
    );
  });

  it("texto livre sem saída 'nenhuma opção' não escolhe destino nenhum", () => {
    // O chamador mantém o contexto parado no mesmo passo nesse caso.
    expect(resolveButtonTarget(MOTIVO_SAIDA, "quero falar com alguém")).toBeNull();
  });

  it("texto livre usa a saída 'nenhuma opção' quando conectada", () => {
    const menuComElse = {
      ...MOTIVO_SAIDA,
      elseGotoStepId: "repetir-menu",
    };
    expect(resolveButtonTarget(menuComElse, "blablabla")).toBe("repetir-menu");
  });

  it("botão sem aresta e passo sem saída padrão cai em 'nenhuma opção'", () => {
    const semDefault = {
      __hasExplicitEdges: true,
      nextStepId: "__none__",
      elseGotoStepId: "repetir-menu",
      buttons: [{ title: "Órfão", gotoStepId: "" }],
    };
    expect(resolveButtonTarget(semDefault, "Órfão")).toBe("repetir-menu");
  });
});
