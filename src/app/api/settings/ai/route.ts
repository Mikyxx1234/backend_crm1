/**
 * GET  /api/settings/ai        → status da chave (sem expor valor).
 * PUT  /api/settings/ai        → salva a chave (criptografada).
 * DELETE /api/settings/ai      → remove a chave do banco.
 *
 * A chave nunca é devolvida em texto puro — o endpoint só informa se
 * há uma configurada, de onde veio (banco/env), quando foi atualizada
 * e um preview mascarado. Isso evita vazar segredos no frontend mesmo
 * para admins.
 */

import { NextResponse } from "next/server";

import { requireAdmin, requireAuth, isManagerOrAdmin } from "@/lib/auth-helpers";
import { getLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { maskSecret } from "@/lib/secret-crypto";
import {
  AI_OPENAI_KEY_SETTING,
  isAIConfigured,
  resetAIProviderCache,
} from "@/services/ai/provider";
import {
  deleteSetting,
  getSecretSetting,
  setSecretSetting,
} from "@/services/settings";

const log = getLogger("api.settings.ai");

type AiStatus = {
  configured: boolean;
  source: "database" | "env" | "none";
  preview: string | null;
  updatedAt: string | null;
};

async function buildStatus(): Promise<AiStatus> {
  const dbValue = await getSecretSetting(AI_OPENAI_KEY_SETTING);
  if (dbValue) {
    const row = await prisma.systemSetting.findUnique({
      where: { key: AI_OPENAI_KEY_SETTING },
      select: { updatedAt: true },
    });
    return {
      configured: true,
      source: "database",
      preview: maskSecret(dbValue),
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  const envValue = process.env.OPENAI_API_KEY?.trim();
  if (envValue) {
    return {
      configured: true,
      source: "env",
      preview: maskSecret(envValue),
      updatedAt: null,
    };
  }

  return {
    configured: false,
    source: "none",
    preview: null,
    updatedAt: null,
  };
}

export async function GET() {
  const r = await requireAuth();
  if (!r.ok) return r.response;

  // Admin e manager veem detalhes; member só vê o bit "configured"
  // para o dashboard decidir se mostra o card IA como disponível.
  if (!isManagerOrAdmin(r.session)) {
    const configured = await isAIConfigured();
    return NextResponse.json({
      configured,
      source: "none" as const,
      preview: null,
      updatedAt: null,
    });
  }

  try {
    return NextResponse.json(await buildStatus());
  } catch (err) {
    log.error("Falha ao ler status da IA:", err);
    return NextResponse.json(
      { message: "Erro ao ler status da IA." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const r = await requireAdmin();
  if (!r.ok) return r.response;

  try {
    const body = (await request.json()) as { apiKey?: unknown };
    const raw = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!raw) {
      return NextResponse.json(
        { message: "apiKey é obrigatória." },
        { status: 400 },
      );
    }
    // Validação simples: chaves OpenAI modernas começam com "sk-" e
    // têm pelo menos algumas dezenas de chars. Não validamos contra
    // a API aqui (fazemos no endpoint /test pra evitar race conditions
    // com a gravação).
    if (!/^sk-[A-Za-z0-9_-]{10,}$/.test(raw)) {
      return NextResponse.json(
        { message: "Formato de chave inválido. Esperado algo como sk-..." },
        { status: 400 },
      );
    }

    await setSecretSetting(AI_OPENAI_KEY_SETTING, raw);
    resetAIProviderCache();
    log.info("Chave OpenAI atualizada pela UI.");
    return NextResponse.json(await buildStatus());
  } catch (err) {
    log.error("Falha ao salvar chave OpenAI:", err);
    return NextResponse.json(
      { message: "Erro ao salvar chave." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const r = await requireAdmin();
  if (!r.ok) return r.response;

  try {
    await deleteSetting(AI_OPENAI_KEY_SETTING);
    resetAIProviderCache();
    log.info("Chave OpenAI removida do banco.");
    return NextResponse.json(await buildStatus());
  } catch (err) {
    log.error("Falha ao remover chave OpenAI:", err);
    return NextResponse.json(
      { message: "Erro ao remover chave." },
      { status: 500 },
    );
  }
}
