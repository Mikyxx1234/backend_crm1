// Diagnóstico read-only: por que campos do flow não aparecem na contacts-aside.
// Uso: node --env-file=.env scripts/diag-flow-panel.mjs [telefoneOuNome]
import { Client } from "pg";

const term = process.argv[2] || "976408816";
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL nao setado."); process.exit(1); }

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// 1) Contato
const contact = (await c.query(
  `SELECT id, name, phone, "organizationId" FROM contacts
   WHERE phone ILIKE '%'||$1||'%' OR name ILIKE '%'||$1||'%'
   ORDER BY "updatedAt" DESC LIMIT 1`, [term]
)).rows[0];
if (!contact) { console.log("Contato nao encontrado para:", term); await c.end(); process.exit(0); }
console.log("=== CONTATO ===");
console.log(contact);

// 2) Campos de contato marcados pro painel (qualquer org? filtra pela org do contato)
const panelFields = (await c.query(
  `SELECT id, name, label, entity, "showInInboxLeadPanel", "inboxLeadPanelOrder"
   FROM custom_fields
   WHERE entity='contact' AND "showInInboxLeadPanel"=true AND "organizationId"=$1
   ORDER BY "inboxLeadPanelOrder" NULLS LAST`, [contact.organizationId]
)).rows;
console.log(`\n=== CAMPOS DE CONTATO COM showInInboxLeadPanel=true (org) : ${panelFields.length} ===`);
console.table(panelFields.map(f => ({ label: f.label, name: f.name, order: f.inboxLeadPanelOrder })));

// 3) Valores gravados pra esse contato (todos os custom fields)
const vals = (await c.query(
  `SELECT cf.label, cf.entity, cf."showInInboxLeadPanel" AS panel, v.value
   FROM contact_custom_field_values v
   JOIN custom_fields cf ON cf.id = v."customFieldId"
   WHERE v."contactId"=$1`, [contact.id]
)).rows;
console.log(`\n=== VALORES DE CAMPOS PERSONALIZADOS GRAVADOS NO CONTATO : ${vals.length} ===`);
console.table(vals.map(v => ({ label: v.label, panel: v.panel, value: (v.value||"").slice(0,40) })));

// 4) Flows da org + campos + mappings
const flows = (await c.query(
  `SELECT * FROM whatsapp_flow_definitions WHERE "organizationId"=$1`,
  [contact.organizationId]
)).rows;
console.log(`\n=== FLOWS DA ORG : ${flows.length} ===`);
for (const f of flows) {
  console.log(`\n--- flow "${f.name}" status=${f.status} (${f.id}) ---`);
  const fields = (await c.query(
    `SELECT ff.*,
            m.target_kind, m.native_key, m.custom_field_id,
            cf.label AS cf_label, cf."showInInboxLeadPanel" AS cf_panel
     FROM whatsapp_flow_fields ff
     JOIN whatsapp_flow_screens sc ON sc.id = ff.screen_id
     LEFT JOIN whatsapp_flow_field_mappings m ON m.field_id = ff.id
     LEFT JOIN custom_fields cf ON cf.id = m.custom_field_id
     WHERE sc.flow_id=$1`, [f.id]
  )).rows;
  console.table(fields.map(x => ({
    field: x.label, key: (x.field_key||"").slice(0,24),
    target: x.target_kind || "SEM MAPPING",
    native: x.native_key || "", cf: x.cf_label || "",
    cf_painel: x.cf_panel === null ? "" : x.cf_panel,
  })));
}

// 5) Entidade/org dos custom fields mapeados (todos os flows publicados)
const mappedCfs = (await c.query(
  `SELECT DISTINCT cf.id, cf.label, cf.entity, cf."organizationId", cf."showInInboxLeadPanel" AS panel
   FROM whatsapp_flow_field_mappings m
   JOIN custom_fields cf ON cf.id = m.custom_field_id
   JOIN whatsapp_flow_fields ff ON ff.id = m.field_id
   JOIN whatsapp_flow_screens sc ON sc.id = ff.screen_id
   JOIN whatsapp_flow_definitions fd ON fd.id = sc.flow_id
   WHERE fd."organizationId"=$1`, [contact.organizationId]
)).rows;
console.log(`\n=== CUSTOM FIELDS MAPEADOS (entidade/org) ===`);
console.table(mappedCfs.map(x => ({ label: x.label, entity: x.entity, org: x.organizationId, panel: x.panel })));

// 6) Deals do contato + valores de campos de deal
const deals = (await c.query(
  `SELECT id, title, status FROM deals WHERE "contactId"=$1`, [contact.id]
)).rows;
console.log(`\n=== DEALS DO CONTATO : ${deals.length} ===`);
for (const d of deals) {
  const dv = (await c.query(
    `SELECT cf.label, cf.entity, cf."showInInboxLeadPanel" AS panel, v.value
     FROM deal_custom_field_values v JOIN custom_fields cf ON cf.id=v."customFieldId"
     WHERE v."dealId"=$1`, [d.id]
  )).rows;
  console.log(`  deal "${d.title}" status=${d.status} -> ${dv.length} valores`);
  console.table(dv.map(v => ({ label: v.label, panel: v.panel, value: (v.value||"").slice(0,40) })));
}

await c.end();
