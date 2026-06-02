// Diagnóstico read-only: por que o MESMO formulário (flow) foi enviado 2x.
// Uso: node --env-file=.env --env-file=.env.local scripts/diag-form-resend.mjs [telefoneOuNome]
import { Client } from "pg";

const term = process.argv[2] || "Navarro";
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL nao setado.");
  process.exit(1);
}

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const trunc = (s, n = 60) => (s == null ? "" : String(s).replace(/\s+/g, " ").slice(0, n));

// 1) Contato
const contact = (
  await c.query(
    `SELECT id, name, phone, "organizationId" FROM contacts
     WHERE phone ILIKE '%'||$1||'%' OR name ILIKE '%'||$1||'%'
     ORDER BY "updatedAt" DESC LIMIT 1`,
    [term],
  )
).rows[0];
if (!contact) {
  console.log("Contato nao encontrado para:", term);
  await c.end();
  process.exit(0);
}
console.log("=== CONTATO ===");
console.log(contact);
const org = contact.organizationId;

// 2) Conversas do contato
const convs = (
  await c.query(
    `SELECT id, channel, status, "createdAt" FROM conversations WHERE "contactId"=$1 ORDER BY "createdAt"`,
    [contact.id],
  )
).rows;
console.log(`\n=== CONVERSAS : ${convs.length} ===`);
console.table(convs.map((x) => ({ id: x.id, channel: x.channel, status: x.status })));
const convIds = convs.map((x) => x.id);

// 3) Mensagens OUT de template/flow na(s) conversa(s)
if (convIds.length) {
  const msgs = (
    await c.query(
      `SELECT id, "externalId", direction, "messageType", content, flow_token,
              template_config_id, "sendStatus", "createdAt"
       FROM messages
       WHERE "conversationId" = ANY($1)
         AND (direction='out')
         AND ("messageType" ILIKE '%template%' OR flow_token IS NOT NULL
              OR template_config_id IS NOT NULL OR content ILIKE '%form%'
              OR content ILIKE '%quali%')
       ORDER BY "createdAt"`,
      [convIds],
    )
  ).rows;
  console.log(`\n=== ENVIOS OUT DE TEMPLATE/FLOW : ${msgs.length} ===`);
  console.table(
    msgs.map((m) => ({
      createdAt: m.createdAt?.toISOString?.() ?? m.createdAt,
      type: m.messageType,
      content: trunc(m.content, 34),
      flow_token: trunc(m.flow_token, 12),
      tplCfg: trunc(m.template_config_id, 10),
      status: m.sendStatus,
    })),
  );

  // 3b) Respostas IN de formulário (flow) na conversa
  const inForms = (
    await c.query(
      `SELECT "messageType", content, "createdAt" FROM messages
       WHERE "conversationId" = ANY($1) AND direction='in'
         AND (content ILIKE '%"flow_token"%' OR content ILIKE '%response_json%'
              OR content ILIKE '%screen%' OR "messageType" ILIKE '%interactive%'
              OR "messageType" ILIKE '%nfm%' OR content ILIKE '%form%')
       ORDER BY "createdAt"`,
      [convIds],
    )
  ).rows;
  console.log(`\n=== RESPOSTAS IN (form/interactive) : ${inForms.length} ===`);
  console.table(
    inForms.map((m) => ({
      createdAt: m.createdAt?.toISOString?.() ?? m.createdAt,
      type: m.messageType,
      content: trunc(m.content, 40),
    })),
  );
}

// 4) Automações deal_created da org
const autos = (
  await c.query(
    `SELECT id, name, "triggerType", active FROM automations
     WHERE "organizationId"=$1 ORDER BY "updatedAt" DESC`,
    [org],
  )
).rows;
console.log(`\n=== AUTOMACOES DA ORG : ${autos.length} ===`);
console.table(autos.map((a) => ({ id: a.id, name: a.name, trigger: a.triggerType, active: a.active })));

// Escolhe a automação alvo: deal_created ativa (ou a 1ª que casar com o nome)
const target =
  autos.find((a) => a.triggerType === "deal_created" && a.active) ||
  autos.find((a) => /recept/i.test(a.name)) ||
  autos.find((a) => a.triggerType === "deal_created");

if (target) {
  console.log(`\n=== AUTOMACAO ALVO: "${target.name}" (${target.id}) trigger=${target.triggerType} ===`);
  const steps = (
    await c.query(
      `SELECT id, position, type, config FROM automation_steps
       WHERE "automationId"=$1 ORDER BY position`,
      [target.id],
    )
  ).rows;
  console.log(`Passos: ${steps.length}`);

  // Mapa id->position pra resolver os destinos dos edges
  const posById = new Map(steps.map((s) => [s.id, s.position]));
  const label = (id) => (id ? `${id} (#${posById.get(id) ?? "?"})` : "—");

  // Extrai edges de saída de um config
  const edgesOf = (cfg) => {
    const out = [];
    if (!cfg || typeof cfg !== "object") return out;
    if (cfg.nextStepId) out.push(["nextStepId", cfg.nextStepId]);
    if (cfg.elseStepId) out.push(["elseStepId", cfg.elseStepId]);
    if (cfg.targetStepId) out.push(["targetStepId", cfg.targetStepId]);
    if (Array.isArray(cfg.branches)) {
      cfg.branches.forEach((b, i) => {
        if (b?.nextStepId) out.push([`branch[${i}].nextStepId`, b.nextStepId]);
      });
    }
    if (Array.isArray(cfg.buttons)) {
      cfg.buttons.forEach((b, i) => {
        if (b?.gotoStepId) out.push([`button[${i}].gotoStepId`, b.gotoStepId]);
      });
    }
    return out;
  };

  // Identifica passos que enviam flow/template
  const isFlowSend = (s) =>
    /template/.test(s.type) ||
    (s.config &&
      (s.config.flowId ||
        s.config.templateName ||
        s.config.flowActionData ||
        s.config.flowToken ||
        /flow|quali|form/i.test(JSON.stringify(s.config))));

  console.log(`\n--- GRAFO (passo -> edges de saida) ---`);
  for (const s of steps) {
    const cfg = s.config || {};
    const edges = edgesOf(cfg);
    const flag = isFlowSend(s) ? "  ⟵ ENVIA FLOW/TEMPLATE?" : "";
    const tpl = cfg.templateName || cfg.flowId || cfg.flowActionData ? `tpl=${trunc(cfg.templateName || cfg.flowId, 24)}` : "";
    console.log(
      `#${String(s.position).padStart(2)} [${s.type}] ${s.id} ${tpl}${flag}`,
    );
    for (const [k, v] of edges) console.log(`        ${k} -> ${label(v)}`);
  }

  // Detecta edges que apontam pra um passo de posicao ANTERIOR (loop pra tras)
  console.log(`\n--- EDGES QUE VOLTAM PRA TRAS (possiveis loops) ---`);
  let loops = 0;
  for (const s of steps) {
    for (const [k, v] of edgesOf(s.config || {})) {
      const fromPos = s.position;
      const toPos = posById.get(v);
      if (toPos != null && toPos <= fromPos) {
        loops++;
        const tgt = steps.find((x) => x.id === v);
        console.log(
          `#${fromPos} [${s.type}] --${k}--> #${toPos} [${tgt?.type}] ${isFlowSend(tgt) ? "⟵ ALVO ENVIA FLOW" : ""}`,
        );
      }
    }
  }
  if (!loops) console.log("(nenhum edge para tras encontrado)");

  // 5) Trace real de execucao pra esse contato
  const logs = (
    await c.query(
      `SELECT "executedAt", "stepId", "stepType", status, message, "metaWebhookEventId", "dealId"
       FROM automation_logs
       WHERE "automationId"=$1 AND "contactId"=$2
       ORDER BY "executedAt"`,
      [target.id, contact.id],
    )
  ).rows;
  console.log(`\n=== TRACE DE EXECUCAO (automation_logs) p/ o contato : ${logs.length} ===`);
  console.table(
    logs.map((l) => ({
      executedAt: l.executedAt?.toISOString?.() ?? l.executedAt,
      stepPos: posById.get(l.stepId) ?? "?",
      stepType: l.stepType,
      status: l.status,
      viaWebhook: l.metaWebhookEventId ? "Y" : "",
      msg: trunc(l.message, 40),
    })),
  );

  // Conta quantas vezes cada passo de flow foi executado
  const flowStepIds = new Set(steps.filter(isFlowSend).map((s) => s.id));
  const counts = {};
  for (const l of logs) if (flowStepIds.has(l.stepId)) counts[l.stepId] = (counts[l.stepId] || 0) + 1;
  console.log(`\n--- EXECUCOES DOS PASSOS DE FLOW/TEMPLATE ---`);
  for (const [sid, n] of Object.entries(counts)) {
    console.log(`  passo #${posById.get(sid)} (${sid}) executado ${n}x`);
  }
}

// 6) AutomationContext do contato
const ctxs = (
  await c.query(
    `SELECT id, "automationId", "currentStepId", status, "timeoutAt", "createdAt", "updatedAt"
     FROM automation_contexts WHERE "contactId"=$1 ORDER BY "createdAt"`,
    [contact.id],
  )
).rows;
console.log(`\n=== AUTOMATION CONTEXTS do contato : ${ctxs.length} ===`);
console.table(
  ctxs.map((x) => ({
    automationId: trunc(x.automationId, 12),
    currentStepId: trunc(x.currentStepId, 12),
    status: x.status,
    createdAt: x.createdAt?.toISOString?.() ?? x.createdAt,
  })),
);

await c.end();
