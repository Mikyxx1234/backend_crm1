/**
 * POST /api/settings/ai/test
 *
 * Faz uma chamada simples à OpenAI com a chave atualmente em uso
 * (banco ou env) para validar que a credencial funciona e que há
 * conectividade. Retorna `{ ok: true, model }` em caso de sucesso ou
 * `{ ok: false, message }` com a mensagem da OpenAI em caso de erro.
 */

import { NextResponse } from "next/server";
import { generateText } from "ai";

import { requireAdmin } from "@/lib/auth-helpers";
import { getLogger } from "@/lib/logger";
import { DEFAULT_CHAT_MODEL, getModel, isAIConfigured } from "@/services/ai/provider";

const log = getLogger("api.settings.ai.test");

export async function POST() {
  const r = await requireAdmin();
  if (!r.ok) return r.response;

  if (!(await isAIConfigured())) {
    return NextResponse.json(
      { ok: false, message: "Nenhuma chave configurada." },
      { status: 400 },
    );
  }

  try {
    const model = await getModel(DEFAULT_CHAT_MODEL);
    const res = await generateText({
      model,
      prompt: "Responda apenas com a palavra: ok",
      maxOutputTokens: 5,
      temperature: 0,
    });
    const text = (res.text ?? "").trim().toLowerCase();
    return NextResponse.json({
      ok: true,
      model: DEFAULT_CHAT_MODEL,
      reply: text.slice(0, 40),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("Teste de chave OpenAI falhou:", message);
    return NextResponse.json(
      { ok: false, message: message.slice(0, 400) },
      { status: 400 },
    );
  }
}
