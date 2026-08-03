// Diagnostico SOMENTE-LEITURA das arestas de saida faltando nos passos
// pausantes (`question`, `send_whatsapp_interactive`, `wait_for_reply`).
//
// Um passo pausante sem a aresta correspondente conectada no canvas nao
// tem pra onde ir quando o cliente responde (ou quando o prazo estoura).
// Ate 03/ago/26 o motor caia no fallback linear `steps[position + 1]` —
// que e' ordem de CRIACAO no editor, nao do fluxo — e vazava pro ramo
// VIZINHO (incidente INICIO-PIPE, ver AGENT.md). Hoje o ramo encerra com
// warning, entao este relatorio lista exatamente o que precisa ser
// conectado no editor pra restaurar a intencao de cada fluxo.
//
// Uso:
//   node scripts/diag-automation-edges.mjs [organizationId]

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

const PAUSING = ["question", "send_whatsapp_interactive", "wait_for_reply"];
const orgFilter = process.argv[2] ?? null;
const bar = (n = 100) => "-".repeat(n);

/** Le referencia de step tratando "" e __none__ (fim de ramo) como ausente. */
function ref(obj, key) {
  const v = obj?.[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return !t || t === "__none__" ? null : t;
}

const client = new Client({ connectionString: loadDatabaseUrl() });
await client.connect();

try {
  const { rows } = await client.query(
    `select o.name as org, o.id as org_id, a.id as auto_id, a.name as auto,
            a.active, a."triggerType", s.id as step_id, s.position, s.type, s.config
       from automation_steps s
       join automations a on a.id = s."automationId"
       join organizations o on o.id = a."organizationId"
      where s.type = ANY($1)
        and ($2::text is null or o.id = $2)
      order by o.name, a.active desc, a.name, s.position`,
    [PAUSING, orgFilter],
  );

  const problems = [];
  for (const r of rows) {
    const cfg = r.config ?? {};
    const faltando = [];

    if (r.type === "wait_for_reply") {
      if (!ref(cfg, "receivedGotoStepId")) faltando.push("resposta recebida");
      if (!ref(cfg, "timeoutGotoStepId")) faltando.push("timeout");
    } else {
      const buttons = Array.isArray(cfg.buttons) ? cfg.buttons : [];
      if (!ref(cfg, "timeoutGotoStepId")) faltando.push("timeout");
      if (buttons.length > 0) {
        if (!ref(cfg, "elseGotoStepId")) faltando.push("nenhuma opcao");
        // Botao sem aresta so e' problema quando o passo tambem nao tem
        // saida padrao (`nextStepId`) pra herdar.
        if (!ref(cfg, "nextStepId")) {
          for (const b of buttons.filter((x) => !ref(x, "gotoStepId"))) {
            faltando.push(`botao "${b?.title || b?.text || b?.id || "?"}"`);
          }
        }
      } else if (!ref(cfg, "nextStepId")) {
        faltando.push("saida unica");
      }
    }

    if (faltando.length > 0) {
      problems.push({
        ...r,
        explicit: cfg.__hasExplicitEdges === true,
        faltando,
      });
    }
  }

  console.log(`\n${bar()}`);
  console.log("  ARESTAS FALTANDO EM PASSOS PAUSANTES");
  console.log(`  ${rows.length} passos pausantes | ${problems.length} com pendencia`);
  console.log(bar());

  let lastOrg = null;
  let lastAuto = null;
  for (const p of problems) {
    if (p.org !== lastOrg) {
      console.log(`\n\n### ORG: ${p.org}  (${p.org_id})`);
      lastOrg = p.org;
      lastAuto = null;
    }
    if (p.auto !== lastAuto) {
      console.log(
        `\n  [${p.active ? "ATIVA  " : "inativa"}] "${p.auto}"  trigger=${p.triggerType}  (${p.auto_id})`,
      );
      lastAuto = p.auto;
    }
    console.log(
      `      ${p.explicit ? "canvas" : "LEGADO"} pos ${String(p.position).padStart(2)} ` +
        `${p.type.padEnd(26)} falta: ${p.faltando.join(", ")}`,
    );
  }

  const ativosCanvas = problems.filter((p) => p.active && p.explicit);
  const ativosLegado = problems.filter((p) => p.active && !p.explicit);
  console.log(`\n\n${bar()}`);
  console.log("  RESUMO");
  console.log(bar());
  console.log(`  ATIVOS desenhados no canvas (ramo encerra):     ${ativosCanvas.length}`);
  console.log(`  ATIVOS legados (mantem fallback linear):        ${ativosLegado.length}`);
  console.log(
    `  Em automacoes inativas:                        ${problems.length - ativosCanvas.length - ativosLegado.length}`,
  );
  console.log("");
} finally {
  await client.end();
}
