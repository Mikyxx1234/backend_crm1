/**
 * Aplica regras acadêmicas DataCrazy em agentes ATENDIMENTO existentes
 * (systemPromptOverride + tools + keywords + model). Sem migration.
 *
 * Uso (backend_crm1, com DATABASE_URL):
 *   npx tsx src/scripts/apply-academic-atendimento-prompt.ts [organizationId]
 */
import { PrismaClient } from "@prisma/client";

import {
  ACADEMIC_HANDOFF_KEYWORDS,
  ACADEMIC_SYSTEM_PROMPT_OVERRIDE,
} from "../lib/ai-agents/academic-atendimento-prompt";
import { getArchetype } from "../lib/ai-agents/archetypes";

/** Atendimento com distribuição por departamento (substitui INICIO-PIPE). */
const ACADEMIC_TOOLS = [
  "add_tag",
  "create_activity",
  "consultar_matricula",
  "transfer_to_department",
  "execute_distribution",
  "transfer_to_human",
];

async function main() {
  const orgId = process.argv[2]?.trim() || null;
  const prisma = new PrismaClient();
  const archetype = getArchetype("ATENDIMENTO");
  try {
    const where = {
      archetype: "ATENDIMENTO" as const,
      ...(orgId ? { organizationId: orgId } : {}),
    };
    const agents = await prisma.aIAgentConfig.findMany({
      where,
      select: {
        id: true,
        enabledTools: true,
        organizationId: true,
        keywordHandoffs: true,
        user: { select: { name: true } },
      },
    });
    console.log(`Encontrados ${agents.length} agente(s) ATENDIMENTO.`);
    for (const a of agents) {
      const tools = Array.from(
        new Set([...(a.enabledTools ?? []), ...ACADEMIC_TOOLS]),
      );
      const keywords = Array.from(
        new Set([...(a.keywordHandoffs ?? []), ...ACADEMIC_HANDOFF_KEYWORDS]),
      );
      await prisma.aIAgentConfig.update({
        where: { id: a.id },
        data: {
          systemPromptTemplate: archetype.systemPromptTemplate,
          systemPromptOverride: ACADEMIC_SYSTEM_PROMPT_OVERRIDE,
          enabledTools: tools,
          keywordHandoffs: keywords,
          model: "gpt-4.1-mini",
          tone: archetype.defaultTone,
        },
      });
      console.log(`  OK ${a.user.name} (${a.id}) org=${a.organizationId}`);
      console.log(`      tools: ${tools.join(", ")}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
