import { NextResponse } from "next/server";

import { withOrgContext } from "@/lib/auth-helpers";
import { analyzeTemplateComponents } from "@/lib/meta-whatsapp/analyze-template-components";
import { resolveMetaTemplatesClient } from "@/lib/meta-whatsapp/resolve-templates-client";
import { prisma } from "@/lib/prisma";

/**
 * Lista TODOS os templates APROVADOS da WABA da organização (via Graph), sem
 * depender do toggle "Agente" (`agentEnabled`). Usado pelos seletores de
 * automação: cada org pode usar seus templates aprovados direto na automação.
 *
 * Mantém o MESMO shape do `/agent-enabled` (metaTemplateName, label, language,
 * category, hasButtons, hasVariables, flowAction, flowId) para os consumidores
 * do frontend funcionarem sem mudança de contrato. O `label` vem do config
 * local quando existir; senão fica vazio (o front cai no metaTemplateName).
 *
 * Sem canal Meta conectado na org -> retorna lista vazia (mesma UX de "nenhum
 * template"), em vez de erro, para não quebrar o dropdown da automação.
 */
type GraphRow = Record<string, unknown>;

function extractAfter(raw: unknown): string | undefined {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const paging = o?.paging as Record<string, unknown> | undefined;
  const cursors = paging?.cursors as Record<string, unknown> | undefined;
  const a = cursors?.after;
  return typeof a === "string" && a.length > 0 ? a : undefined;
}

export async function GET() {
  return withOrgContext(async (session) => {
    try {
      const resolved = await resolveMetaTemplatesClient({
        organizationId: session.user.organizationId,
        isSuperAdmin: session.user.isSuperAdmin,
      });
      // Sem canal/credenciais Meta na org: nada aprovado para listar.
      if (!resolved.ok) {
        return NextResponse.json([]);
      }

      // Labels amigáveis do config local (opcional; só enriquece o rótulo).
      const configs = await prisma.whatsAppTemplateConfig.findMany({
        select: {
          metaTemplateId: true,
          metaTemplateName: true,
          label: true,
          agentEnabled: true,
        },
      });
      const labelById = new Map<string, string>();
      const labelByName = new Map<string, string>();
      const agentByName = new Map<string, boolean>();
      for (const c of configs) {
        if (c.metaTemplateId) labelById.set(c.metaTemplateId, c.label ?? "");
        if (c.metaTemplateName) {
          labelByName.set(c.metaTemplateName, c.label ?? "");
          agentByName.set(c.metaTemplateName, c.agentEnabled);
        }
      }

      const out: Array<Record<string, unknown>> = [];
      let after: string | undefined;
      do {
        const raw = await resolved.client.listMessageTemplates({ limit: 500, after });
        const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        const data = Array.isArray(o.data) ? (o.data as GraphRow[]) : [];
        for (const row of data) {
          const status = String(row.status ?? "").toUpperCase();
          if (status !== "APPROVED") continue;
          const name = typeof row.name === "string" ? row.name : "";
          if (!name) continue;
          const id = typeof row.id === "string" ? row.id : "";
          const components = Array.isArray(row.components) ? (row.components as unknown[]) : [];
          const pf = typeof row.parameter_format === "string" ? row.parameter_format : null;
          const analysis = analyzeTemplateComponents(components, { parameterFormat: pf });

          out.push({
            metaTemplateId: id,
            metaTemplateName: name,
            label: labelById.get(id) || labelByName.get(name) || "",
            language: typeof row.language === "string" ? row.language : "pt_BR",
            category: typeof row.category === "string" ? row.category : null,
            agentEnabled: agentByName.get(name) ?? false,
            bodyPreview: analysis.bodyText ?? "",
            hasButtons: analysis.hasButtons,
            buttonTypes: analysis.buttonTypes,
            buttons: analysis.buttons,
            hasVariables: analysis.hasVariables,
            flowAction: analysis.flowAction,
            flowId: analysis.flowId,
          });
        }
        after = extractAfter(raw);
      } while (after);

      out.sort((a, b) => {
        const la = String(a.label || a.metaTemplateName || "");
        const lb = String(b.label || b.metaTemplateName || "");
        return la.localeCompare(lb);
      });

      return NextResponse.json(out);
    } catch (e) {
      return NextResponse.json(
        { message: e instanceof Error ? e.message : "Erro." },
        { status: 500 },
      );
    }
  });
}
