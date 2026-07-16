/**
 * Prepara CSV pronto para import de matriculados (deals), a partir do xlsx
 * "Relação de matriculados por polo", removendo quem JÁ existe na dev.
 *
 * - Dedup intra-arquivo: 1 pessoa (chave email → telefone normalizado).
 * - Remove da saída quem já existe na dev (match por email OU telefone, com
 *   variantes do 9º dígito BR).
 * - external_id = RG (anti-duplicata em reimportações futuras).
 * - NÃO inclui stage (você define na hora de subir).
 *
 * Uso:
 *   node --env-file=.env scripts/prepare-matriculados-import.mjs "C:/caminho/arquivo.xlsx"
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const IN = process.argv[2] || "C:/Users/EDUIT/Downloads/bases/Relação de matriculados por polo.xlsx";

const onlyDigits = (s) => String(s ?? "").replace(/\D/g, "");
function toE164BR(raw) {
  let d = onlyDigits(raw);
  if (!d) return "";
  if (!(d.startsWith("55") && d.length >= 12)) d = "55" + d;
  return "+" + d;
}
function phoneVariants(raw) {
  const e = toE164BR(raw);
  if (!e) return [];
  const set = new Set([e]);
  if (e.startsWith("+55")) {
    const local = e.slice(3), ddd = local.slice(0, 2), sub = local.slice(2);
    if (sub.length === 9 && sub.startsWith("9")) set.add("+55" + ddd + sub.slice(1));
    else if (sub.length === 8 && /^[6-9]/.test(sub)) set.add("+55" + ddd + "9" + sub);
  }
  return [...set];
}
const emailNorm = (s) => String(s ?? "").trim().toLowerCase();

// 1) Lê xlsx
const wb = XLSX.readFile(IN);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
console.log(`Arquivo: ${rows.length} linhas`);

// 2) Chaves existentes na dev
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const o = process.env.TARGET_ORG_ID ||
  (await c.query(`SELECT "organizationId" FROM contacts GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`)).rows[0].organizationId;
const emailSet = new Set();
const phoneSet = new Set();
for (const r of (await c.query(`SELECT lower(email) e FROM contacts WHERE "organizationId"=$1 AND email<>''`, [o])).rows) emailSet.add(r.e);
for (const r of (await c.query(`SELECT phone FROM contacts WHERE "organizationId"=$1 AND phone<>''`, [o])).rows)
  for (const v of phoneVariants(r.phone)) phoneSet.add(v);
// email de cf de negócio (reforço)
const cfEmail = (await c.query(`SELECT id FROM custom_fields WHERE "organizationId"=$1 AND entity='deal' AND name='email' LIMIT 1`, [o])).rows[0]?.id;
if (cfEmail) for (const r of (await c.query(`SELECT lower(value) e FROM deal_custom_field_values WHERE "customFieldId"=$1 AND value<>''`, [cfEmail])).rows) emailSet.add(r.e);
await c.end();
console.log(`Dev: ${emailSet.size} emails, ${phoneSet.size} variantes de telefone`);

// 3) Dedup intra-arquivo (1 por pessoa) + 4) remover existentes
const seen = new Set();
let dupFile = 0, already = 0, kept = 0;
const out = [];
for (const r of rows) {
  const email = emailNorm(r["Email"]);
  const vars = phoneVariants(r["Fone celular"]);
  const personKey = email || vars[0] || onlyDigits(r["RG"]);
  if (!personKey) continue;
  if (seen.has(personKey)) { dupFile++; continue; }
  seen.add(personKey);
  const existsInDev = (email && emailSet.has(email)) || vars.some((v) => phoneSet.has(v));
  if (existsInDev) { already++; continue; }
  kept++;
  out.push({
    title: String(r["Nome"] ?? "").trim(),
    external_id: onlyDigits(r["RG"]) || "",
    contact_name: String(r["Nome"] ?? "").trim(),
    contact_phone: toE164BR(r["Fone celular"]).replace(/^\+/, ""),
    contact_email: email,
    email: email,
    email_academico: emailNorm(r["Email acadêmico"]),
    curso: String(r["Curso"] ?? "").trim(),
    data_de_nascimento: String(r["Data Nascimento"] ?? "").trim(),
    polo: String(r["Polo"] ?? "").trim(),
    situacao_matricula: String(r["Situação Matrícula"] ?? "").trim(),
  });
}
console.log(`\nDuplicados no arquivo (mesma pessoa): ${dupFile}`);
console.log(`Já existem na dev (removidos): ${already}`);
console.log(`✅ NOVOS a importar: ${kept}`);

// 5) CSV ; + BOM
const headers = ["title","external_id","contact_name","contact_phone","contact_email","email","email_academico","curso","data_de_nascimento","polo","situacao_matricula"];
const esc = (v) => { const s = v == null ? "" : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const lines = [headers.join(";"), ...out.map((row) => headers.map((h) => esc(row[h])).join(";"))];
const stamp = new Date().toISOString().slice(0, 10);
const outPath = `C:/Users/EDUIT/Downloads/matriculados-novos-para-importar-${stamp}.csv`;
writeFileSync(outPath, "\ufeff" + lines.join("\r\n"), "utf8");
console.log(`\nCSV salvo: ${outPath}`);
