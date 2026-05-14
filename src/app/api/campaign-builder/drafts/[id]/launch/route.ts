import { NextResponse } from "next/server";

import { authenticateApiRequest, runWithApiUserContext } from "@/lib/api-auth";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { launchDraft } from "@/services/campaign-builder";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return runWithApiUserContext(authResult.user, async () => {
    try {
      if (!authResult.user.organizationId) {
        return NextResponse.json(
          { error: { code: "ORG_REQUIRED", message: "Sessão sem organização." } },
          { status: 401 },
        );
      }
      const enabled = await isFeatureEnabled(
        "campaign_builder_v2",
        authResult.user.organizationId,
      );
      if (!enabled) {
        return NextResponse.json(
          { error: { code: "FEATURE_DISABLED", message: "campaign_builder_v2 desabilitada." } },
          { status: 403 },
        );
      }
      const { id } = await params;
      const launched = await launchDraft(id, {
        id: authResult.user.id,
        role: authResult.user.role,
      });
      return NextResponse.json({ data: launched });
    } catch (error) {
      if (error instanceof Error && error.message === "FORBIDDEN_DRAFT_ACCESS") {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Sem permissão para lançar este rascunho." } },
          { status: 403 },
        );
      }
      return NextResponse.json(
        { error: { code: "DRAFT_LAUNCH_ERROR", message: error instanceof Error ? error.message : "Falha no lançamento do rascunho." } },
        { status: 500 },
      );
    }
  });
}
