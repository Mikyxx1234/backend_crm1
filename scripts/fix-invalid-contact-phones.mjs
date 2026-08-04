/**
 * Corrige telefones de contato que não são discáveis.
 *
 * Contexto (04/ago/26): até a validação em `parseContactPhoneInput` existir,
 * as rotas de escrita gravavam o valor cru quando a normalização falhava.
 * Integrações produziram registros como `"+5585991940125, +558591940125"`,
 * `"+5511958101572languageSalesforce, +5511958101572"` e `"Farmácia"`. Todos
 * passam no `replace(/\D/g, "")` do envio e viram números impossíveis na
 * Meta — o contato fica inalcançável sem nenhum erro visível.
 *
 * Regra de recuperação:
 *   - Um único número reconhecível  → grava ele, em E.164.
 *   - Variantes do mesmo número (9º dígito) → prefere a forma COM o 9, que é
 *     a usada pela Meta hoje.
 *   - Números realmente distintos   → mantém o primeiro (ordem da origem).
 *   - Nenhum número reconhecível    → limpa o campo.
 *
 * Uso:
 *   node scripts/fix-invalid-contact-phones.mjs            # dry-run
 *   node scripts/fix-invalid-contact-phones.mjs --apply    # grava
 *   node scripts/fix-invalid-contact-phones.mjs --apply --org <id>
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ENV_PATH = "C:/Users/Caio/Desktop/.env produção.txt";
const APPLY = process.argv.includes("--apply");
const orgFlag = process.argv.indexOf("--org");
const ORG = orgFlag !== -1 ? process.argv[orgFlag + 1] : null;

// ── Cópia fiel de src/lib/phone.ts (script .mjs não importa TS) ──────────

const E164_RE = /^\+\d{7,15}$/;
const MULTI_NUMBER_SPLIT_RE = /[,;/|]+|\s+e\s+/i;

const strip = (raw) => raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");

function normalizeBrLocal(local) {
  return local.length === 11 || local.length === 10 ? `+55${local}` : null;
}

function normalizePhone(raw) {
  if (!raw) return null;
  const s = strip(String(raw).trim());
  if (!s) return null;
  if (E164_RE.test(s)) return s;
  const digits = s.startsWith("+") ? s.slice(1) : s;
  if (digits.startsWith("55")) return normalizeBrLocal(digits.slice(2));
  if (digits.length === 10 || digits.length === 11) return normalizeBrLocal(digits);
  if (digits.length >= 7 && digits.length <= 15) {
    const candidate = `+${digits}`;
    return E164_RE.test(candidate) ? candidate : null;
  }
  return null;
}

function extractPhoneCandidates(raw) {
  const out = [];
  for (const part of String(raw).split(MULTI_NUMBER_SPLIT_RE)) {
    const n = normalizePhone(part);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function phoneMatchVariants(raw) {
  const n = normalizePhone(raw);
  if (!n) return [];
  const variants = new Set([n]);
  if (n.startsWith("+55")) {
    const local = n.slice(3);
    const ddd = local.slice(0, 2);
    const sub = local.slice(2);
    if (sub.length === 9 && sub.startsWith("9")) variants.add(`+55${ddd}${sub.slice(1)}`);
    else if (sub.length === 8 && /^[6-9]/.test(sub)) variants.add(`+55${ddd}9${sub}`);
  }
  return [...variants];
}

/** Escolhe o melhor candidato — ver "Regra de recuperação" no topo. */
function pickBest(candidates) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const [first, ...rest] = candidates;
  const firstVariants = phoneMatchVariants(first);
  const allSameNumber = rest.every((c) => firstVariants.includes(c));
  if (!allSameNumber) return first;
  return [...candidates].sort((a, b) => b.length - a.length)[0];
}

// ── Execução ─────────────────────────────────────────────────────────────

const raw = fs.readFileSync(ENV_PATH, "utf8");
const url = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.startsWith("DATABASE_URL"))
  .map((l) => l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""))[0];
if (!url) throw new Error("DATABASE_URL não encontrada em " + ENV_PATH);

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows } = await c.query(
  `select id, "organizationId", number, name, phone
     from contacts
    where phone is not null
      and phone !~ '^\\+[0-9]{7,15}$'
      ${ORG ? 'and "organizationId" = $1' : ""}
    order by "organizationId", number`,
  ORG ? [ORG] : [],
);

if (rows.length === 0) {
  console.log("Nenhum telefone inválido encontrado.");
  await c.end();
  process.exit(0);
}

const plan = rows.map((r) => {
  const candidates = extractPhoneCandidates(r.phone);
  const next = pickBest(candidates);
  return {
    ...r,
    next,
    action: next === null ? "LIMPAR" : "CORRIGIR",
    detected: candidates.length,
  };
});

console.log(`\n${plan.length} contato(s) com telefone inválido${ORG ? ` na org ${ORG}` : ""}:\n`);
console.table(
  plan.map((p) => ({
    org: p.organizationId.slice(0, 12),
    "#": p.number,
    nome: (p.name ?? "").slice(0, 28),
    de: p.phone,
    para: p.next ?? "(vazio)",
    acao: p.action,
  })),
);

const byAction = plan.reduce((acc, p) => ({ ...acc, [p.action]: (acc[p.action] ?? 0) + 1 }), {});
console.log("\nResumo:", byAction);

if (!APPLY) {
  console.log("\nDry-run. Rode com --apply para gravar.");
  await c.end();
  process.exit(0);
}

// `backups/` já é ignorado pelo git — o dump tem telefone de gente real.
const backupDir = path.join(process.cwd(), "backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(
  backupDir,
  `invalid-phones-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
fs.writeFileSync(backupPath, JSON.stringify(plan, null, 2), "utf8");
console.log(`\nBackup salvo em ${backupPath}`);

let updated = 0;
try {
  await c.query("begin");
  for (const p of plan) {
    await c.query(`update contacts set phone = $1, "updatedAt" = now() where id = $2`, [
      p.next,
      p.id,
    ]);
    // Rastro na timeline do contato — o operador consegue ver de onde veio a mudança.
    await c.query(
      `insert into activity_events
         (id, "organizationId", "occurredAt", type, "entityType", "entityId", "entityLabel",
          "contactId", "actorType", "actorLabel", field, "oldValue", "newValue", meta)
       values (gen_random_uuid()::text, $1, now(), 'CONTACT_FIELD_CHANGED', 'CONTACT', $2, $3,
               $2, 'SYSTEM', 'Correção de telefone inválido', 'phone', $4, $5,
               '{"field":"phone","label":"Telefone","source":"fix-invalid-contact-phones"}'::jsonb)`,
      [p.organizationId, p.id, p.name, p.phone, p.next],
    );
    updated += 1;
  }
  await c.query("commit");
} catch (e) {
  await c.query("rollback");
  console.error("\nRollback — nada foi gravado:", e);
  await c.end();
  process.exit(1);
}

const { rows: left } = await c.query(
  `select count(*)::int as total
     from contacts
    where phone is not null and phone !~ '^\\+[0-9]{7,15}$'
      ${ORG ? 'and "organizationId" = $1' : ""}`,
  ORG ? [ORG] : [],
);

console.log(`\n${updated} contato(s) atualizado(s). Telefones inválidos restantes: ${left[0].total}`);
await c.end();
