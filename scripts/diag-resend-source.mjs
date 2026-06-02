// Origem do reenvio de form__quali_estag_em (06-01). Read-only.
import { Client } from "pg";
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const trunc = (s, n = 80) => (s == null ? "" : String(s).replace(/\s+/g, " ").slice(0, n));

const contact = (await c.query(
  `SELECT id, "organizationId" FROM contacts WHERE name ILIKE '%Navarro%' ORDER BY "updatedAt" DESC LIMIT 1`
)).rows[0];
const conv = (await c.query(
  `SELECT id FROM conversations WHERE "contactId"=$1 ORDER BY "createdAt" LIMIT 1`, [contact.id]
)).rows[0];

// Todas as OUT com detalhe de autoria
const outs = (await c.query(
  `SELECT id, "externalId", "messageType", "authorType", "senderName", "aiAgentUserId",
          template_config_id, flow_token, "sendStatus", content, "createdAt"
   FROM messages
   WHERE "conversationId"=$1 AND direction='out'
     AND ("messageType" ILIKE '%template%' OR content ILIKE '%form__quali%' OR content ILIKE '%form_estag%')
   ORDER BY "createdAt"`, [conv.id]
)).rows;
console.log("=== ENVIOS OUT (autoria) ===");
for (const m of outs) {
  console.log({
    createdAt: m.createdAt?.toISOString?.(),
    type: m.messageType,
    authorType: m.authorType,
    senderName: m.senderName,
    aiAgent: m.aiAgentUserId,
    tplCfg: m.template_config_id,
    status: m.sendStatus,
    content: trunc(m.content, 50),
  });
}

// Mensagens vizinhas (qualquer tipo) na janela do reenvio 06-01
console.log("\n=== JANELA 06-01 21:00 .. 06-02 02:00 (todas as msgs) ===");
const win = (await c.query(
  `SELECT direction, "messageType", "authorType", "senderName", content, "createdAt"
   FROM messages WHERE "conversationId"=$1
     AND "createdAt" >= '2026-06-01T20:00:00Z' AND "createdAt" <= '2026-06-02T03:00:00Z'
   ORDER BY "createdAt"`, [conv.id]
)).rows;
for (const m of win) console.log({
  at: m.createdAt?.toISOString?.(), dir: m.direction, type: m.messageType,
  author: m.authorType, sender: m.senderName, content: trunc(m.content, 50),
});

// Scheduled messages p/ a conversa/contato
console.log("\n=== SCHEDULED MESSAGES (contato) ===");
try {
  const sched = (await c.query(
    `SELECT id, status, "scheduledFor", "sentAt", "messageType", content, "createdAt"
     FROM scheduled_messages WHERE "contactId"=$1 ORDER BY "createdAt" DESC LIMIT 20`, [contact.id]
  )).rows;
  if (!sched.length) console.log("(nenhuma)");
  for (const s of sched) console.log({ status: s.status, scheduledFor: s.scheduledFor?.toISOString?.(), sentAt: s.sentAt?.toISOString?.(), type: s.messageType, content: trunc(s.content, 40) });
} catch (e) { console.log("scheduled_messages:", e.message); }

// Campaign recipients
console.log("\n=== CAMPAIGN RECIPIENTS (contato) ===");
try {
  const cr = (await c.query(
    `SELECT cr.id, cr.status, cr."metaMessageId", cr."createdAt", c.name AS campaign, c.type
     FROM campaign_recipients cr JOIN campaigns c ON c.id=cr."campaignId"
     WHERE cr."contactId"=$1 ORDER BY cr."createdAt" DESC LIMIT 20`, [contact.id]
  )).rows;
  if (!cr.length) console.log("(nenhum)");
  for (const r of cr) console.log({ campaign: r.campaign, type: r.type, status: r.status, at: r.createdAt?.toISOString?.() });
} catch (e) { console.log("campaign_recipients:", e.message); }

await c.end();
