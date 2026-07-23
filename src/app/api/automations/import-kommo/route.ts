import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { requirePermission } from "@/lib/authz";
import { parseKommoBot } from "@/lib/kommo-bot-parser";
import { createAutomation, updateAutomation } from "@/services/automations";
import type { Prisma } from "@prisma/client";

// Bug 27/abr/26: este endpoint chamava `auth()` direto e os services
// `createAutomation` / `updateAutomation` chamam `getOrgIdOrThrow()`
// SINCRONO. Mesma classe de bug do POST /api/automations principal.
// Migrado para withOrgContext.

// 23/jul/26 — Chaves conhecidas de "referencia de step" no config de
// qualquer tipo de passo. Mesma lista canonica usada por
// `remapStepRefsInValue` em services/automations.ts (Kommo legado
// + formato nativo + condition multi-branch novo). Manter em sync
// caso surjam novos step types com novas chaves de referencia.
const STEP_REF_KEYS = new Set<string>([
  "_nextStepId",
  "_trueGotoStepId",
  "_falseGotoStepId",
  "_answeredGotoStepId",
  "timeoutGotoStepId",
  "elseGotoStepId",
  "elseStepId",
  "targetStepId",
  "gotoStepId",
  "nextStepId",
  "receivedGotoStepId",
]);

/**
 * Remap recursivo dos ids de step dentro de um config. Caminha em toda
 * a arvore (objetos e arrays) e troca strings que estejam sob uma
 * `STEP_REF_KEYS` — ou dentro do array `buttons[]` (`gotoStepId`) e
 * `_branches[]` (`gotoStepId`) — usando `idMap`.
 *
 * Cobertura necessaria para o formato nativo:
 *   - `condition.branches[i].nextStepId`  (formato novo multi-branch)
 *   - `condition.elseStepId`              (formato novo multi-branch)
 *   - `question.buttons[i].gotoStepId`    (ja coberto pelo case buttons)
 *   - Todos os `_nextStepId`, `_trueGotoStepId`, etc. do formato legado
 *
 * Antes: implementacao chapada olhava so a raiz + `buttons[]` + `_branches[]`
 * — `branches[].nextStepId` e `elseStepId` (usados pelo executor moderno
 * em `automation-executor#normalizeConditionConfig`) escapavam do remap,
 * deixando pernas do fluxo mortas ao importar um export com condition
 * multi-branch.
 */
function remapIds(config: Record<string, unknown>, idMap: Map<string, string>): Record<string, unknown> {
  const remapValue = (value: unknown, parentKey?: string): unknown => {
    if (typeof value === "string") {
      if (parentKey && STEP_REF_KEYS.has(parentKey) && value !== "" && idMap.has(value)) {
        return idMap.get(value);
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => remapValue(entry, parentKey));
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = remapValue(v, k);
      }
      return out;
    }
    return value;
  };

  return remapValue(config) as Record<string, unknown>;
}

type ParsedImport = {
  name: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  steps: Array<{ id: string; type: string; config: Record<string, unknown> }>;
  source: "kommo" | "native";
};

function parseNativeExport(json: Record<string, unknown>): ParsedImport {
  const name = typeof json.name === "string" && json.name.trim() ? json.name.trim() : "Automação importada";
  const triggerType =
    typeof json.triggerType === "string" && json.triggerType.trim()
      ? json.triggerType.trim()
      : "message_received";
  const triggerConfig =
    typeof json.triggerConfig === "object" && json.triggerConfig !== null && !Array.isArray(json.triggerConfig)
      ? (json.triggerConfig as Record<string, unknown>)
      : {};
  const rawSteps = Array.isArray(json.steps) ? (json.steps as unknown[]) : [];
  const steps = rawSteps
    .map((raw, idx) => {
      if (typeof raw !== "object" || raw === null) return null;
      const s = raw as Record<string, unknown>;
      const type = typeof s.type === "string" ? s.type.trim() : "";
      if (!type) return null;
      const idRaw = typeof s.id === "string" && s.id.trim() ? s.id.trim() : `import_step_${idx + 1}`;
      const config =
        typeof s.config === "object" && s.config !== null && !Array.isArray(s.config)
          ? (s.config as Record<string, unknown>)
          : {};
      return { id: idRaw, type, config };
    })
    .filter((s): s is { id: string; type: string; config: Record<string, unknown> } => Boolean(s));
  if (steps.length === 0) {
    throw new Error("JSON de automação inválido: nenhum passo encontrado.");
  }
  return {
    name,
    triggerType,
    triggerConfig,
    steps,
    source: "native",
  };
}

function parseImportPayload(json: Record<string, unknown>): ParsedImport {
  // Formato Kommo legado
  if (json.model && typeof json.model === "object") {
    const parsed = parseKommoBot(json);
    return {
      name: parsed.name,
      triggerType: parsed.triggerType,
      triggerConfig: parsed.triggerConfig as Record<string, unknown>,
      steps: parsed.steps.map((s) => ({
        id: s.id,
        type: s.type,
        config: s.config as Record<string, unknown>,
      })),
      source: "kommo",
    };
  }
  // Formato nativo exportado pelo próprio CRM (Exportar JSON)
  if (Array.isArray(json.steps) && typeof json.triggerType === "string") {
    return parseNativeExport(json);
  }
  throw new Error(
    "JSON inválido: esperado export do Kommo (campo model) ou export nativo de automação (steps + triggerType).",
  );
}

export async function POST(request: Request) {
  return withOrgContext(async (session) => {
    const denied = await requirePermission(session.user, "automation:create");
    if (denied) return denied;
    try {
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

      let parsed: ParsedImport;
      try {
        parsed = parseImportPayload(json);
      } catch (err) {
        console.error("[import-kommo] Parse error:", err);
        return NextResponse.json(
          { message: `Erro ao parsear bot: ${err instanceof Error ? err.message : String(err)}` },
          { status: 400 },
        );
      }

      // 23/jul/26 — Propaga `s.id` fornecido no export (mesmo pattern
      // que `POST /api/automations`). Quando o export ja traz ids
      // proprios (ex: conversor Digisac que preserva os UUIDs de
      // `blocks[]`), o remap fica no-op e nao dependemos do idMap para
      // manter a topologia. Se o export nao trouxer ids, o Prisma
      // gera cuids e a idMap resolve os refs no update abaixo.
      const automation = await createAutomation({
        name: parsed.name,
        description:
          parsed.source === "kommo"
            ? `Importado do Kommo (${parsed.steps.length} passos)`
            : `Importado de JSON (${parsed.steps.length} passos)`,
        triggerType: parsed.triggerType,
        triggerConfig: parsed.triggerConfig as Prisma.InputJsonValue,
        active: false,
        steps: parsed.steps.map((s) => ({
          ...(s.id ? { id: s.id } : {}),
          type: s.type,
          config: s.config as Prisma.InputJsonValue,
        })),
      });

      const idMap = new Map<string, string>();
      for (let i = 0; i < parsed.steps.length; i++) {
        const tempId = parsed.steps[i].id;
        const realId = automation.steps[i]?.id;
        if (tempId && realId && tempId !== realId) {
          idMap.set(tempId, realId);
        }
      }

      // BUG 27/abr: nao propagavamos `s.id` aqui. O updateAutomation do
      // service deleta todos os steps e recria. Sem id explicito, Prisma
      // gera cuids novos via `@default(cuid())` e os refs remappeados
      // (recem-feitos com idMap apontando pros ids "reais") viram pernas
      // mortas — mesmo sintoma do save normal. Preservar `s.id` mantem a
      // topologia do fluxo importado intacta.
      const remappedSteps = automation.steps.map((s: typeof automation.steps[number]) => {
        const cfg = (typeof s.config === "object" && s.config !== null && !Array.isArray(s.config))
          ? { ...(s.config as Record<string, unknown>) }
          : {};
        return {
          id: s.id,
          type: s.type,
          config: remapIds(cfg, idMap) as Prisma.InputJsonValue,
        };
      });

      const updated = await updateAutomation(automation.id, {
        steps: remappedSteps,
      });

      return NextResponse.json(
        {
          message:
            parsed.source === "kommo"
              ? `Bot "${parsed.name}" importado com sucesso! ${parsed.steps.length} passos criados.`
              : `Automação "${parsed.name}" importada com sucesso! ${parsed.steps.length} passos criados.`,
          automationId: updated.id,
          stepCount: parsed.steps.length,
          source: parsed.source,
        },
        { status: 201 },
      );
    } catch (e) {
      console.error("[import-kommo]", e);
      return NextResponse.json({ message: "Erro ao importar bot." }, { status: 500 });
    }
  });
}
