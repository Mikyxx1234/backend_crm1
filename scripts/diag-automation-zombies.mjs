// Diagnostico SOMENTE-LEITURA dos contextos de automacao presos no sweeper
// de timeout (`sweepExpiredTimeouts`, take 50 a cada 30s).
//
// Um contexto "zumbi" fica com status=RUNNING e timeoutAt vencido para
// sempre porque `processTimeout` retorna cedo sem limpar o campo quando o
// currentStepId nao existe mais ou nao e' um step pausante. Cada zumbi
// ocupa uma das 50 vagas por rodada, atrasando/bloqueando os timeouts
// legitimos.
//
// Uso:
//   node scripts/diag-automation-zombies.mjs [automationId]

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = resolve(__dirname, "..", ".env");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("DATABASE_URL nao encontrado no ambiente nem em .env");
}

const TARGET_AUTOMATION = process.argv[2] ?? "cmrxn191x0uz7o101espk5e99";

// Mesma lista de PAUSING_STEP_TYPES em src/services/automation-context.ts
// + "delay": espera persistida via timeoutAt (não é zumbi).
const PAUSING_STEP_TYPES = [
  "question",
  "send_whatsapp_interactive",
  "send_whatsapp_template",
  "wait_for_reply",
  "delay",
];

const c = new Client({ connectionString: loadDatabaseUrl() });
await c.connect();

function header(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

function table(rows) {
  if (rows.length === 0) {
    console.log("  (nenhum registro)");
    return;
  }
  console.table(rows);
}

// ── 1. Panorama geral do backlog ────────────────────────────────────────
header("1. Contextos RUNNING com timeoutAt vencido (backlog do sweeper)");

const backlog = (
  await c.query(`
  SELECT
    count(*)                                                              AS vencidos_total,
    count(*) FILTER (WHERE "timeoutAt" < now() - interval '2 minutes')    AS atraso_2min,
    count(*) FILTER (WHERE "timeoutAt" < now() - interval '30 minutes')   AS atraso_30min,
    count(*) FILTER (WHERE "timeoutAt" < now() - interval '1 hour')       AS atraso_1h,
    count(*) FILTER (WHERE "timeoutAt" < now() - interval '1 day')        AS atraso_1dia,
    count(*) FILTER (WHERE "timeoutAt" < now() - interval '7 days')       AS atraso_7dias,
    min("timeoutAt")                                                      AS mais_antigo
  FROM automation_contexts
  WHERE status = 'RUNNING' AND "timeoutAt" IS NOT NULL AND "timeoutAt" <= now()
`)
).rows[0];

table([backlog]);

const capacidade = 100; // 50 por rodada x 2 rodadas/min
const total = Number(backlog.vencidos_total);
console.log(
  `\n  Capacidade do sweeper: ~${capacidade} contextos/min (take 50 a cada 30s).`,
);
if (total > 50) {
  console.log(
    `  ⚠ Ha ${total} vencidos e a rodada processa so 50 — ha disputa por vaga.`,
  );
}

// ── 2. Zumbis por causa raiz ────────────────────────────────────────────
header("2. Classificacao dos vencidos por causa");

const causas = (
  await c.query(
    `
  SELECT
    CASE
      WHEN ctx."currentStepId" IS NULL              THEN 'sem currentStepId'
      WHEN s.id IS NULL                             THEN 'ZUMBI: step inexistente (orfao)'
      WHEN NOT (s.type = ANY($1::text[]))           THEN 'ZUMBI: step nao-pausante (' || s.type || ')'
      ELSE 'processavel (step pausante valido)'
    END AS causa,
    count(*) AS qtd,
    min(ctx."timeoutAt") AS mais_antigo,
    max(ctx."timeoutAt") AS mais_recente
  FROM automation_contexts ctx
  LEFT JOIN automation_steps s ON s.id = ctx."currentStepId"
  WHERE ctx.status = 'RUNNING'
    AND ctx."timeoutAt" IS NOT NULL
    AND ctx."timeoutAt" <= now()
  GROUP BY 1
  ORDER BY qtd DESC
`,
    [PAUSING_STEP_TYPES],
  )
).rows;

table(causas);

const zumbis = causas
  .filter((r) => String(r.causa).startsWith("ZUMBI"))
  .reduce((acc, r) => acc + Number(r.qtd), 0);

console.log(
  `\n  Total de zumbis (nunca saem da fila): ${zumbis}` +
    (zumbis >= 50
      ? "  ⚠⚠ >= 50 — o sweeper esta 100% saturado, NENHUM timeout legitimo dispara."
      : zumbis > 0
        ? `  ⚠ ocupam ${zumbis} das 50 vagas de cada rodada.`
        : "  ✓ nenhum zumbi detectado."),
);

// ── 3. Distribuicao por automacao ───────────────────────────────────────
header("3. Vencidos por automacao");

table(
  (
    await c.query(
      `
  SELECT
    a.name AS automacao,
    a.id   AS automation_id,
    a.active,
    count(*) AS vencidos,
    count(*) FILTER (WHERE s.id IS NULL) AS orfaos,
    count(*) FILTER (WHERE s.id IS NOT NULL AND NOT (s.type = ANY($1::text[]))) AS nao_pausantes,
    min(ctx."timeoutAt") AS mais_antigo
  FROM automation_contexts ctx
  JOIN automations a ON a.id = ctx."automationId"
  LEFT JOIN automation_steps s ON s.id = ctx."currentStepId"
  WHERE ctx.status = 'RUNNING'
    AND ctx."timeoutAt" IS NOT NULL
    AND ctx."timeoutAt" <= now()
  GROUP BY a.id, a.name, a.active
  ORDER BY vencidos DESC
  LIMIT 25
`,
      [PAUSING_STEP_TYPES],
    )
  ).rows,
);

// ── 4. Amostra dos zumbis ───────────────────────────────────────────────
header("4. Amostra de zumbis (os 30 mais antigos)");

table(
  (
    await c.query(
      `
  SELECT
    ctx.id                AS context_id,
    a.name                AS automacao,
    ctx."currentStepId",
    COALESCE(s.type, '(step apagado)') AS step_type,
    ctx."timeoutAt",
    date_trunc('second', now() - ctx."timeoutAt")::text AS parado_ha,
    ctx."updatedAt"
  FROM automation_contexts ctx
  JOIN automations a ON a.id = ctx."automationId"
  LEFT JOIN automation_steps s ON s.id = ctx."currentStepId"
  WHERE ctx.status = 'RUNNING'
    AND ctx."timeoutAt" IS NOT NULL
    AND ctx."timeoutAt" <= now()
    AND (s.id IS NULL OR NOT (s.type = ANY($1::text[])))
  ORDER BY ctx."timeoutAt" ASC
  LIMIT 30
`,
      [PAUSING_STEP_TYPES],
    )
  ).rows,
);

// ── 5. Foco na automacao alvo ───────────────────────────────────────────
header(`5. Automacao alvo: ${TARGET_AUTOMATION}`);

const alvo = (
  await c.query(
    `SELECT id, name, active, "triggerType" FROM automations WHERE id = $1`,
    [TARGET_AUTOMATION],
  )
).rows;

if (alvo.length === 0) {
  console.log("  Automacao nao encontrada.");
} else {
  table(alvo);

  console.log("\n  Steps atuais:");
  table(
    (
      await c.query(
        `SELECT id, type, position, config->>'timeoutMs' AS timeout_ms,
                config->>'timeoutGotoStepId' AS timeout_goto,
                config->>'receivedGotoStepId' AS received_goto
         FROM automation_steps WHERE "automationId" = $1 ORDER BY position`,
        [TARGET_AUTOMATION],
      )
    ).rows,
  );

  console.log("\n  Contextos por status:");
  table(
    (
      await c.query(
        `SELECT status, count(*) AS qtd,
                count(*) FILTER (WHERE "timeoutAt" IS NOT NULL AND "timeoutAt" <= now()) AS vencidos,
                count(*) FILTER (WHERE "timeoutAt" IS NOT NULL AND "timeoutAt" > now())  AS aguardando
         FROM automation_contexts WHERE "automationId" = $1 GROUP BY status ORDER BY qtd DESC`,
        [TARGET_AUTOMATION],
      )
    ).rows,
  );

  console.log("\n  Contextos RUNNING vencidos (amostra, mais antigos):");
  table(
    (
      await c.query(
        `SELECT ctx.id AS context_id, ctx."contactId", ctx."currentStepId",
                COALESCE(s.type, '(step apagado)') AS step_type,
                ctx."timeoutAt",
                date_trunc('second', now() - ctx."timeoutAt")::text AS parado_ha
         FROM automation_contexts ctx
         LEFT JOIN automation_steps s ON s.id = ctx."currentStepId"
         WHERE ctx."automationId" = $1 AND ctx.status = 'RUNNING'
           AND ctx."timeoutAt" IS NOT NULL AND ctx."timeoutAt" <= now()
         ORDER BY ctx."timeoutAt" ASC LIMIT 20`,
        [TARGET_AUTOMATION],
      )
    ).rows,
  );
}

// ── 6. Contextos RUNNING sem timeoutAt (relogio perdido) ────────────────
header("6. Contextos RUNNING parados em step pausante SEM timeoutAt");
console.log(
  "  (relogio zerado por advanceContext sem timeoutMs — nunca disparam por timeout)\n",
);

table(
  (
    await c.query(
      `
  SELECT a.name AS automacao, s.type AS step_type, count(*) AS qtd,
         min(ctx."updatedAt") AS mais_antigo
  FROM automation_contexts ctx
  JOIN automations a ON a.id = ctx."automationId"
  JOIN automation_steps s ON s.id = ctx."currentStepId"
  WHERE ctx.status = 'RUNNING'
    AND ctx."timeoutAt" IS NULL
    AND s.type = ANY($1::text[])
  GROUP BY a.name, s.type
  ORDER BY qtd DESC
  LIMIT 20
`,
      [PAUSING_STEP_TYPES],
    )
  ).rows,
);

await c.end();
console.log("\nDiagnostico concluido (nenhuma escrita foi feita).\n");
