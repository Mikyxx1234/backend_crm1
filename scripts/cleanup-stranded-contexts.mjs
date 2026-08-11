/**
 * Fecha contextos de automação "órfãos": status=RUNNING, timeoutAt IS NULL,
 * parados em passo não-pausante (ou sem currentStepId). Esses ficam
 * acumulados quando um passo falha e o fluxo abandona sem chamar finish.
 *
 * NÃO toca contextos parados em passo pausante (question / interactive /
 * template / wait_for_reply) — pausa legítima aguardando resposta.
 *
 * Uso:
 *   node --env-file=.env scripts/cleanup-stranded-contexts.mjs --org=<id>           # dry-run
 *   node --env-file=.env scripts/cleanup-stranded-contexts.mjs --org=<id> --apply   # aplica
 *
 * Requer DATABASE_URL no ambiente (mesma do backend).
 */
import { Client } from "pg";

const APPLY = process.argv.includes("--apply");
const orgArg = process.argv.find((a) => a.startsWith("--org="));
const ORG_ID = orgArg ? orgArg.slice("--org=".length).trim() : "";

if (!ORG_ID) {
  console.error("Uso: node scripts/cleanup-stranded-contexts.mjs --org=<id> [--apply]");
  process.exit(1);
}

// Mesma lista de PAUSING_STEP_TYPES em src/services/automation-context.ts
// + "delay": espera persistida via timeoutAt (ver shouldPersistDelay) —
// contexto parado em delay com cronômetro NÃO é zumbi, é espera legítima.
const PAUSING_STEP_TYPES = [
  "question",
  "send_whatsapp_interactive",
  "send_whatsapp_template",
  "wait_for_reply",
  "delay",
];

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const selectSql = `
  SELECT
    ctx.id,
    ctx."automationId",
    a.name AS automation_name,
    ctx."currentStepId",
    s.type AS step_type
  FROM automation_contexts ctx
  JOIN automations a ON a.id = ctx."automationId"
  LEFT JOIN automation_steps s ON s.id = ctx."currentStepId"
  WHERE ctx.status = 'RUNNING'
    AND ctx."timeoutAt" IS NULL
    AND ctx."organizationId" = $1
    AND (
      ctx."currentStepId" IS NULL
      OR s.id IS NULL
      OR NOT (s.type = ANY($2::text[]))
    )
  ORDER BY a.name, s.type NULLS FIRST, ctx."updatedAt"
`;

const { rows } = await c.query(selectSql, [ORG_ID, PAUSING_STEP_TYPES]);

console.log(`Modo: ${APPLY ? "APPLY (grava)" : "DRY-RUN (não grava)"} | org=${ORG_ID}`);
console.log(`Contextos órfãos encontrados: ${rows.length}`);

// Resumo agrupado por automação + tipo de passo
const groups = new Map();
for (const r of rows) {
  const stepType = r.step_type ?? "(sem currentStepId)";
  const key = `${r.automationId}\t${r.automation_name}\t${stepType}`;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}

console.log("\nResumo por automação / tipo de passo:");
if (groups.size === 0) {
  console.log("  (nenhum)");
} else {
  for (const [key, qtd] of groups) {
    const [, name, stepType] = key.split("\t");
    console.log(`  ${qtd.toString().padStart(5)}  ${name}  ·  ${stepType}`);
  }
}

if (!APPLY) {
  console.log("\nDry-run: nada gravado. Rode com --apply para aplicar.");
  await c.end();
  process.exit(0);
}

if (rows.length === 0) {
  console.log("\nNada a atualizar.");
  await c.end();
  process.exit(0);
}

const ids = rows.map((r) => r.id);
const upd = await c.query(
  `UPDATE automation_contexts
      SET status = 'COMPLETED',
          "currentStepId" = NULL,
          "timeoutAt" = NULL,
          "updatedAt" = now()
    WHERE id = ANY($1::text[])`,
  [ids],
);

console.log(`\n✅ Atualizados: ${upd.rowCount} contextos → COMPLETED.`);
await c.end();
