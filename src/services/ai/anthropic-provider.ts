/**
 * Provider Anthropic (Claude) — usado exclusivamente pelo Copilot de
 * Automações. O agente conversacional que fala com contatos continua
 * no OpenAI (ver `provider.ts`).
 *
 * Segregamos os dois porque:
 *   - Claude é melhor em raciocínio sobre grafos e emissão de patches
 *     estruturados (nosso caso de uso aqui).
 *   - Trocar o modelo do chatbot mexe em tools/prompts calibrados pro
 *     GPT e muda o comportamento percebido pelo contato — fora do
 *     escopo desta feature.
 *
 * Chave lida por `getSecretSettingOrEnv("ai.anthropic.apiKey",
 * "ANTHROPIC_API_KEY")` — mesma convenção do OpenAI, então no futuro
 * o admin pode cadastrá-la pela UI de Configurações sem alterar
 * código nem reiniciar o processo.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import {
  generateText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";

import { getSecretSettingOrEnv } from "@/services/settings";

export const AI_ANTHROPIC_KEY_SETTING = "ai.anthropic.apiKey";

/**
 * Default: Claude Sonnet 4.6 — o modelo de fronteira atual (Fev/2026),
 * melhor relação custo/capacidade pro tool-loop do copilot. Pode ser
 * sobrescrito via AUTOMATION_COPILOT_MODEL (ex.: "claude-opus-4-5"
 * para análise mais profunda/casos complexos, ou "claude-haiku-4-5"
 * pra respostas mais rápidas/baratas). Aceita qualquer ID válido do
 * AI SDK Anthropic.
 */
export const DEFAULT_COPILOT_MODEL =
  process.env.AUTOMATION_COPILOT_MODEL ?? "claude-sonnet-4-6";

let cachedClient: ReturnType<typeof createAnthropic> | null = null;
let cachedKey: string | null = null;

async function getAnthropic() {
  const apiKey = (
    await getSecretSettingOrEnv(AI_ANTHROPIC_KEY_SETTING, "ANTHROPIC_API_KEY")
  ).trim();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY não configurada. Declare a variável no .env ou cadastre em Configurações → IA.",
    );
  }
  if (cachedClient && cachedKey === apiKey) return cachedClient;
  cachedClient = createAnthropic({ apiKey });
  cachedKey = apiKey;
  return cachedClient;
}

/**
 * Invalida o cliente em cache — chamar sempre que a chave mudar na UI
 * para que a próxima chamada reinstancie o SDK com a credencial nova.
 */
export function resetAnthropicProviderCache(): void {
  cachedClient = null;
  cachedKey = null;
}

export async function isAnthropicConfigured(): Promise<boolean> {
  const apiKey = (
    await getSecretSettingOrEnv(AI_ANTHROPIC_KEY_SETTING, "ANTHROPIC_API_KEY")
  ).trim();
  return apiKey.length > 0;
}

export async function getAnthropicModel(
  modelName: string = DEFAULT_COPILOT_MODEL,
): Promise<LanguageModel> {
  const anthropic = await getAnthropic();
  return anthropic(modelName);
}

export type AnthropicGenerateArgs = {
  model?: string;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  temperature?: number;
  maxOutputTokens?: number;
  /// Limite de passos do tool loop. Default 12 — maior que OpenAI
  /// porque o copilot costuma encadear várias tools de leitura antes
  /// de propor patch.
  maxSteps?: number;
};

export type AnthropicGenerateResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: Array<{ toolName: string; args: unknown; result: unknown }>;
  steps: number;
};

export async function generateWithAnthropic(
  args: AnthropicGenerateArgs,
): Promise<AnthropicGenerateResult> {
  const model = await getAnthropicModel(args.model ?? DEFAULT_COPILOT_MODEL);
  const result = await generateText({
    model,
    system: args.system,
    messages: args.messages,
    tools: args.tools,
    temperature: args.temperature ?? 0.3,
    maxOutputTokens: args.maxOutputTokens,
    stopWhen: stepCountIs(args.maxSteps ?? 12),
  });

  const toolCalls: AnthropicGenerateResult["toolCalls"] = [];
  for (const step of result.steps) {
    for (const call of step.toolCalls ?? []) {
      const matchedResult = (step.toolResults ?? []).find(
        (r) =>
          (r as { toolCallId?: string }).toolCallId ===
          (call as { toolCallId?: string }).toolCallId,
      );
      toolCalls.push({
        toolName: (call as { toolName: string }).toolName,
        args:
          (call as { input?: unknown; args?: unknown }).input ??
          (call as { args?: unknown }).args,
        result: matchedResult
          ? ((matchedResult as { output?: unknown; result?: unknown }).output ??
            (matchedResult as { result?: unknown }).result)
          : undefined,
      });
    }
  }

  return {
    text: result.text ?? "",
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    toolCalls,
    steps: result.steps.length,
  };
}
