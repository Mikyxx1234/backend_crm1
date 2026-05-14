import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-helpers";
import {
  PIPELINE_TEMPLATES,
  type PipelineTemplateId,
} from "@/lib/onboarding-templates";
import { applyPipelineTemplate } from "@/services/onboarding";

const VALID_IDS = new Set<PipelineTemplateId>(
  Object.keys(PIPELINE_TEMPLATES) as PipelineTemplateId[],
);

export async function POST(request: Request) {
  const r = await requireAuth();
  if (!r.ok) return r.response;
  const orgId = r.session.user.organizationId;
  if (!orgId) {
    return NextResponse.json({ message: "Sem organização." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const templateId =
    typeof b.templateId === "string" ? (b.templateId as PipelineTemplateId) : null;
  if (!templateId || !VALID_IDS.has(templateId)) {
    return NextResponse.json({ message: "Template inválido." }, { status: 400 });
  }

  try {
    const result = await applyPipelineTemplate(orgId, templateId);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao aplicar template.";
    return NextResponse.json({ message: msg }, { status: 400 });
  }
}
