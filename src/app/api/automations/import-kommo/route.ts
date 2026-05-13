import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { parseKommoBot } from "@/lib/kommo-bot-parser";
import { createAutomation, updateAutomation } from "@/services/automations";
import type { Prisma } from "@prisma/client";

function remapIds(config: Record<string, unknown>, idMap: Map<string, string>): Record<string, unknown> {
  const result = { ...config };

  const stringFields = [
    "_nextStepId", "_trueGotoStepId", "_falseGotoStepId",
    "timeoutGotoStepId", "elseGotoStepId", "_answeredGotoStepId",
    "targetStepId", "gotoStepId",
  ];

  for (const field of stringFields) {
    if (typeof result[field] === "string" && result[field] !== "") {
      result[field] = idMap.get(result[field] as string) ?? result[field];
    }
  }

  if (Array.isArray(result.buttons)) {
    result.buttons = (result.buttons as { text: string; gotoStepId: string }[]).map((btn) => ({
      ...btn,
      gotoStepId: idMap.get(btn.gotoStepId) ?? btn.gotoStepId,
    }));
  }

  if (Array.isArray(result._branches)) {
    result._branches = (result._branches as { conditions: unknown[]; gotoStepId: string }[]).map((br) => ({
      ...br,
      gotoStepId: idMap.get(br.gotoStepId) ?? br.gotoStepId,
    }));
  }

  return result;
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ message: "Corpo inválido." }, { status: 400 });
    }

    const json = body as Record<string, unknown>;
    if (!json.model || typeof json.model !== "object") {
      return NextResponse.json(
        { message: "JSON não parece ser um export de bot Kommo (campo model ausente)." },
        { status: 400 },
      );
    }

    let parsed;
    try {
      parsed = parseKommoBot(json);
    } catch (err) {
      console.error("[import-kommo] Parse error:", err);
      return NextResponse.json(
        { message: `Erro ao parsear bot: ${err instanceof Error ? err.message : String(err)}` },
        { status: 400 },
      );
    }

    const automation = await createAutomation({
      name: parsed.name,
      description: `Importado do Kommo (${parsed.steps.length} passos)`,
      triggerType: parsed.triggerType,
      triggerConfig: parsed.triggerConfig as Prisma.InputJsonValue,
      active: false,
      steps: parsed.steps.map((s) => ({
        type: s.type,
        config: s.config as Prisma.InputJsonValue,
      })),
    });

    const idMap = new Map<string, string>();
    for (let i = 0; i < parsed.steps.length; i++) {
      const tempId = parsed.steps[i].id;
      const realId = automation.steps[i]?.id;
      if (tempId && realId) {
        idMap.set(tempId, realId);
      }
    }

    const remappedSteps = automation.steps.map((s) => {
      const cfg = (typeof s.config === "object" && s.config !== null && !Array.isArray(s.config))
        ? { ...(s.config as Record<string, unknown>) }
        : {};
      return {
        type: s.type,
        config: remapIds(cfg, idMap) as Prisma.InputJsonValue,
      };
    });

    const updated = await updateAutomation(automation.id, {
      steps: remappedSteps,
    });

    return NextResponse.json(
      {
        message: `Bot "${parsed.name}" importado com sucesso! ${parsed.steps.length} passos criados.`,
        automationId: updated.id,
        stepCount: parsed.steps.length,
      },
      { status: 201 },
    );
  } catch (e) {
    console.error("[import-kommo]", e);
    return NextResponse.json({ message: "Erro ao importar bot." }, { status: 500 });
  }
}
