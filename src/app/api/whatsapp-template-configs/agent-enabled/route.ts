import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { analyzeTemplateComponents } from "@/lib/meta-whatsapp/analyze-template-components";
import { listMessageTemplatesByGraphId } from "@/lib/meta-whatsapp/list-message-templates-index";
import { resolveMetaTemplatesClient } from "@/lib/meta-whatsapp/resolve-templates-client";
import { prisma } from "@/lib/prisma";

/**
 * Lista templates habilitados para o agente. Quando o canal Meta Cloud da org
 * está disponível, mescla metadados (botões, variáveis, Flow) a partir da
 * Graph — evita envio como texto por BD desatualizado sem backfill.
 */
export async function GET() {
  return withOrgContext(async (session) => {
    try {
      const configs = await prisma.whatsAppTemplateConfig.findMany({
        where: { agentEnabled: true },
        orderBy: { label: "asc" },
      });

      const resolved = await resolveMetaTemplatesClient({
        organizationId: session.user.organizationId,
        isSuperAdmin: session.user.isSuperAdmin,
      });

      let graphMap: Awaited<ReturnType<typeof listMessageTemplatesByGraphId>> | null = null;
      if (resolved.ok) {
        try {
          graphMap = await listMessageTemplatesByGraphId(resolved.client);
        } catch {
          graphMap = null;
        }
      }

      const enriched = configs.map((row) => {
        const id = typeof row.metaTemplateId === "string" ? row.metaTemplateId.trim() : "";
        const hit = id && graphMap ? graphMap.get(id) : undefined;
        if (!hit) return row;

        const analysis = analyzeTemplateComponents(hit.components, {
          parameterFormat: hit.parameterFormat,
        });

        return {
          ...row,
          hasButtons: analysis.hasButtons,
          buttonTypes: analysis.buttonTypes,
          hasVariables: analysis.hasVariables,
          flowAction: analysis.flowAction,
          flowId: analysis.flowId,
        };
      });

      return NextResponse.json(enriched);
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro." },
        { status: 500 },
      );
    }
  });
}
