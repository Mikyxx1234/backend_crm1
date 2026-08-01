/**
 * GET/PUT /api/distribution/settings
 * Configurações org-scoped da Distribuição Inteligente.
 *
 * Expõe:
 *   - `respectDepartment`:
 *       - false (default): distribuição CLÁSSICA org-wide (todos os elegíveis),
 *         ignorando departamento — nada fica preso na fila por falta de roteamento.
 *       - true: quando a conversa tem um departamento com distribuição automática
 *         ligada, restringe aos membros desse departamento; sem departamento cai
 *         no org-wide.
 *   - `saturdayEnabled` / `saturdayStart` / `saturdayEnd`: janela de expediente
 *     de SÁBADO no nível da org. Como `AgentSchedule` tem um único horário para
 *     todos os dias (sem horário por dia), o sábado — com horário próprio e para
 *     todos os consultores — é modelado aqui. Quando ligado, no sábado a
 *     elegibilidade usa `[start, end)` para todos (ver `eligibility.ts`).
 *
 * PUT aceita atualização PARCIAL (só grava as chaves presentes no corpo).
 * Gateado por `smart_distribution` + `distribution:execute`.
 */

import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { can, loadAuthzContext } from "@/lib/authz";
import {
  getOrgSetting,
  getOrgSettingBool,
  setOrgSetting,
  setOrgSettingBool,
} from "@/lib/org-settings";
import {
  assertSmartDistributionEnabled,
  WidgetNotEnabledError,
} from "@/services/organization-widgets";

const KEY = "distribution.respectDepartment";
const SATURDAY_KEY = "distribution.saturdayWindow";
const SATURDAY_TZ = "America/Sao_Paulo";
const DEFAULT_SATURDAY = { enabled: false, start: "09:00", end: "13:00" };

const HHMM = /^\d{2}:\d{2}$/;
function normalizeTime(v: unknown, fallback: string): string {
  return typeof v === "string" && HHMM.test(v.trim()) ? v.trim() : fallback;
}

async function readSaturday(): Promise<{
  enabled: boolean;
  start: string;
  end: string;
}> {
  const raw = await getOrgSetting(SATURDAY_KEY);
  if (!raw) return { ...DEFAULT_SATURDAY };
  try {
    const p = JSON.parse(raw) as {
      enabled?: unknown;
      start?: unknown;
      end?: unknown;
    };
    return {
      enabled: Boolean(p.enabled),
      start: normalizeTime(p.start, DEFAULT_SATURDAY.start),
      end: normalizeTime(p.end, DEFAULT_SATURDAY.end),
    };
  } catch {
    return { ...DEFAULT_SATURDAY };
  }
}

async function guard(session: {
  user: { id: string; organizationId: string | null; isSuperAdmin: boolean };
}): Promise<NextResponse | null> {
  const ctx = await loadAuthzContext({
    userId: session.user.id,
    organizationId: session.user.organizationId,
    isSuperAdmin: session.user.isSuperAdmin,
  });
  if (!can(ctx, "distribution:execute")) {
    return NextResponse.json(
      { message: "Acesso negado.", required: "distribution:execute" },
      { status: 403 },
    );
  }
  try {
    await assertSmartDistributionEnabled();
  } catch (e) {
    if (e instanceof WidgetNotEnabledError) {
      return NextResponse.json(
        {
          message: "Módulo de Distribuição não habilitado para esta organização.",
          code: "SMART_DISTRIBUTION_NOT_ENABLED",
        },
        { status: 403 },
      );
    }
    throw e;
  }
  return null;
}

export async function GET() {
  return withOrgContext(async (session) => {
    const denied = await guard(session);
    if (denied) return denied;
    const [respectDepartment, saturday] = await Promise.all([
      getOrgSettingBool(KEY, false),
      readSaturday(),
    ]);
    return NextResponse.json({
      respectDepartment,
      saturdayEnabled: saturday.enabled,
      saturdayStart: saturday.start,
      saturdayEnd: saturday.end,
    });
  });
}

export async function PUT(req: Request) {
  return withOrgContext(async (session) => {
    const denied = await guard(session);
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as {
      respectDepartment?: unknown;
      saturdayEnabled?: unknown;
      saturdayStart?: unknown;
      saturdayEnd?: unknown;
    };

    // Atualização PARCIAL: só toca as chaves presentes no corpo.
    if ("respectDepartment" in body) {
      await setOrgSettingBool(KEY, Boolean(body.respectDepartment));
    }

    const touchesSaturday =
      "saturdayEnabled" in body ||
      "saturdayStart" in body ||
      "saturdayEnd" in body;
    if (touchesSaturday) {
      const current = await readSaturday();
      const next = {
        enabled:
          "saturdayEnabled" in body
            ? Boolean(body.saturdayEnabled)
            : current.enabled,
        start:
          "saturdayStart" in body
            ? normalizeTime(body.saturdayStart, current.start)
            : current.start,
        end:
          "saturdayEnd" in body
            ? normalizeTime(body.saturdayEnd, current.end)
            : current.end,
        timezone: SATURDAY_TZ,
      };
      await setOrgSetting(SATURDAY_KEY, JSON.stringify(next));
    }

    const [respectDepartment, saturday] = await Promise.all([
      getOrgSettingBool(KEY, false),
      readSaturday(),
    ]);
    return NextResponse.json({
      respectDepartment,
      saturdayEnabled: saturday.enabled,
      saturdayStart: saturday.start,
      saturdayEnd: saturday.end,
    });
  });
}
