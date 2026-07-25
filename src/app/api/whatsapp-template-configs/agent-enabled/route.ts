import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { analyzeTemplateComponents } from "@/lib/meta-whatsapp/analyze-template-components";
import { listMessageTemplatesByGraphId } from "@/lib/meta-whatsapp/list-message-templates-index";
import { resolveMetaTemplatesClient } from "@/lib/meta-whatsapp/resolve-templates-client";
import { prisma } from "@/lib/prisma";

type GraphMap = Awaited<ReturnType<typeof listMessageTemplatesByGraphId>>;

/**
 * Cache TTL em memória do catálogo Graph (map por graph-template-id), POR ORG.
 *
 * `listMessageTemplatesByGraphId` pagina TODO o catálogo da WABA (limit=500,
 * com todos os componentes) — payload de centenas de KB. Este endpoint é
 * chamado sempre que o agente abre o composer / picker / modal "/", por
 * múltiplos agentes. Sem cache, cada abertura re-busca e re-parseia o
 * catálogo inteiro da Meta na thread web (CPU + latência).
 *
 * TTL curto (60s) mantém os metadados praticamente frescos (mudança de
 * template é rara) e elimina o refetch em rajada. Chave = organizationId.
 */
const GRAPH_MAP_TTL_MS = 60_000;
const graphMapCache = new Map<string, { at: number; map: GraphMap }>();

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

      const orgId = session.user.organizationId;
      let graphMap: GraphMap | null = null;

      const cached = orgId ? graphMapCache.get(orgId) : undefined;
      if (cached && Date.now() - cached.at < GRAPH_MAP_TTL_MS) {
        graphMap = cached.map;
      } else {
        const resolved = await resolveMetaTemplatesClient({
          organizationId: orgId,
          isSuperAdmin: session.user.isSuperAdmin,
        });
        if (resolved.ok) {
          try {
            graphMap = await listMessageTemplatesByGraphId(resolved.client);
            if (orgId) graphMapCache.set(orgId, { at: Date.now(), map: graphMap });
          } catch {
            graphMap = null;
          }
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
