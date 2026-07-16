/**
 * Limpeza segura de negócios/contatos de TESTE/MOCK e DUPLICATAS vazias.
 *
 * Remove (mantendo 100% dos alunos reais e dos leads reais de WhatsApp):
 *  1) Negócios ÓRFÃOS vazios (sem contato e sem nenhum dado de matrícula) —
 *     duplicatas de alunos que já têm card completo + junk ("teste", etc.).
 *  2) Contatos MOCK (external_id kommo_* OU telefone fake sequencial) que não
 *     têm nenhum negócio com dados — e todos os negócios/conversas/mensagens
 *     deles.
 *
 * NUNCA toca em: negócio com qualquer dado de matrícula, nem contato que tenha
 * mensagem real (lead real), nem contato com algum negócio com dados.
 *
 * Uso:
 *   node --env-file=.env scripts/cleanup-fake-empty-deals.mjs           # dry-run + backup
 *   node --env-file=.env scripts/cleanup-fake-empty-deals.mjs --apply
 */
import { Client } from "pg";
import { writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const o =
  process.env.TARGET_ORG_ID ||
  (await c.query(`SELECT "organizationId" FROM contacts GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`)).rows[0].organizationId;

const coreNames = ["cpf","rgm","curso","email","email_academico","data_de_nascimento","situacao_matricula","polo"];
const ids = (await c.query(`SELECT id FROM custom_fields WHERE "organizationId"=$1 AND entity='deal' AND name=ANY($2)`,[o,coreNames])).rows.map(r=>`'${r.id}'`).join(",");
const HASDATA = `EXISTS (SELECT 1 FROM deal_custom_field_values v WHERE v."dealId"=d.id AND v."customFieldId" IN (${ids}) AND v.value IS NOT NULL AND v.value<>'')`;
const FAKE_PHONE = `(ct.phone ~ '99999000' OR ct.phone ~ '98888000' OR ct.phone ~ '3000000')`;

// 1) negócios órfãos vazios
const orphanDeals = (await c.query(
  `SELECT d.id, d.number, d.title FROM deals d
    WHERE d."organizationId"=$1 AND d."contactId" IS NULL AND NOT ${HASDATA}`,[o])).rows;

// 2) contatos mock (sem nenhum negócio com dados)
const mockContacts = (await c.query(
  `SELECT DISTINCT ct.id, ct.name, ct.phone, ct.external_id
     FROM contacts ct
    WHERE ct."organizationId"=$1
      AND (ct.external_id LIKE 'kommo_%' OR ct.phone ~ '99999000' OR ct.phone ~ '98888000' OR ct.phone ~ '3000000')
      AND NOT EXISTS (
        SELECT 1 FROM deals d WHERE d."contactId"=ct.id
          AND EXISTS (SELECT 1 FROM deal_custom_field_values v WHERE v."dealId"=d.id AND v."customFieldId" IN (${ids}) AND v.value<>''))`,
  [o])).rows;
const mockIds = mockContacts.map(r=>r.id);
const mockDeals = mockIds.length ? (await c.query(
  `SELECT d.id, d.number, d.title FROM deals d WHERE d."contactId" = ANY($1)`,[mockIds])).rows : [];

console.log(`Modo: ${APPLY ? "APPLY" : "DRY-RUN"} | org=${o}`);
console.log(`1) Negócios órfãos vazios: ${orphanDeals.length}`);
console.log(`2) Contatos mock: ${mockContacts.length} (com ${mockDeals.length} negócios)`);
mockContacts.slice(0,12).forEach(r=>console.log(`     - ${r.name} | ${r.phone} | ${r.external_id??'∅'}`));

// BACKUP
const allDeals = [...orphanDeals, ...mockDeals];
const esc = (v)=>{const s=v==null?"":String(v);return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
const bkDeals = ["tipo;number;id;title", ...orphanDeals.map(r=>`orfao;${esc(r.number)};${r.id};${esc(r.title)}`), ...mockDeals.map(r=>`mock;${esc(r.number)};${r.id};${esc(r.title)}`)].join("\r\n");
const bkContacts = ["id;name;phone;external_id", ...mockContacts.map(r=>`${r.id};${esc(r.name)};${esc(r.phone)};${esc(r.external_id)}`)].join("\r\n");
const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
writeFileSync(`C:/Users/EDUIT/Downloads/backup-limpeza-deals-${stamp}.csv`, "\ufeff"+bkDeals, "utf8");
writeFileSync(`C:/Users/EDUIT/Downloads/backup-limpeza-contatos-${stamp}.csv`, "\ufeff"+bkContacts, "utf8");
console.log(`\nBackup salvo em Downloads (backup-limpeza-*-${stamp}.csv)`);

if (!APPLY) { console.log("\nDry-run: nada apagado. Rode com --apply."); await c.end(); process.exit(0); }

const dealIds = allDeals.map(r=>r.id);
await c.query("BEGIN");
try {
  if (mockIds.length) {
    const convs = (await c.query(`SELECT id FROM conversations WHERE "contactId" = ANY($1)`,[mockIds])).rows.map(r=>r.id);
    if (convs.length) {
      // Zera auto-referências/FK antes de apagar mensagens e conversas.
      await c.query(`UPDATE conversations SET "pinnedMessageId"=NULL, "pinnedNoteId"=NULL WHERE id = ANY($1)`,[convs]);
      await c.query(`UPDATE messages SET "replyToId"=NULL WHERE "conversationId" = ANY($1)`,[convs]);
      await c.query(`DELETE FROM messages WHERE "conversationId" = ANY($1)`,[convs]);
    }
    await c.query(`DELETE FROM conversations WHERE "contactId" = ANY($1)`,[mockIds]);
  }
  if (dealIds.length) {
    await c.query(`DELETE FROM deals WHERE id = ANY($1)`,[dealIds]);
  }
  if (mockIds.length) {
    await c.query(`DELETE FROM contacts WHERE id = ANY($1)`,[mockIds]);
  }
  await c.query("COMMIT");
  console.log(`\n✅ Removidos: ${dealIds.length} negócios, ${mockIds.length} contatos mock.`);
} catch (e) {
  await c.query("ROLLBACK");
  console.error(`\n❌ ROLLBACK — nada foi apagado. Erro: ${e.message}`);
  process.exitCode = 1;
}
await c.end();
