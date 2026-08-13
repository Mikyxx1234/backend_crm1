import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Origem de automacao do passo em execucao — "qual card fez isso".
 *
 * Motivacao (pedido do operador): na timeline do negocio nao havia como
 * saber POR QUE alguem foi distribuido/atribuido. O ator do evento ja
 * dizia "Automação: <nome>", mas nao QUAL card do editor executou a
 * acao. Este contexto viaja pelo AsyncLocalStorage durante o
 * `executeStep` e o `logEvent` central o grava em `meta.automationOrigin`
 * de TODO evento produzido dentro do passo — inclusive os escritos por
 * services chamados indiretamente (ex.: motor da Distribuicao
 * Inteligente), sem precisar passar parametro por 10 camadas.
 *
 * Mesma tecnica/motivo do `request-context.ts` (ALS ancorada em
 * globalThis para sobreviver ao HMR).
 */
export type AutomationOrigin = {
  automationId: string;
  /// Snapshot do nome da automacao na hora da execucao.
  automationName?: string | null;
  stepId?: string | null;
  stepType?: string | null;
  /**
   * Numero do card como o usuario ve no editor de automacoes: indice
   * 1-based na lista de steps ordenada por `position` (mesma ordem que
   * o `workflow-canvas` usa para o badge do node).
   */
  stepNumber?: number | null;
  /// Rotulo pt-BR do tipo do passo (ex.: "Executar distribuição").
  stepLabel?: string | null;
};

const globalForOrigin = globalThis as unknown as {
  __crmAutomationOriginStorage?: AsyncLocalStorage<AutomationOrigin>;
};

const storage =
  globalForOrigin.__crmAutomationOriginStorage ??
  new AsyncLocalStorage<AutomationOrigin>();

globalForOrigin.__crmAutomationOriginStorage = storage;

/// Executa `fn` marcando tudo que acontecer dentro como originado de
/// `origin`. Aninhamentos (automacao que dispara automacao) sobrescrevem
/// pelo escopo mais interno, que e o correto: quem realmente executou.
export function runWithAutomationOrigin<T>(
  origin: AutomationOrigin,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return storage.run(origin, fn);
}

export function getAutomationOrigin(): AutomationOrigin | undefined {
  return storage.getStore();
}
