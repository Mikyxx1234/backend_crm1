/**
 * Recupera o NOME real do contato a partir do TÍTULO do negócio.
 *
 * Contexto: uma importação antiga gravou o TELEFONE na coluna "Nome do
 * contato", enquanto o nome real do aluno foi parar no "Título" do negócio.
 * Resultado: ~8.2k contatos com `name` = telefone. Este script corrige isso
 * copiando o título (quando ele contém um nome real) para o nome do contato.
 *
 * Só toca contatos cujo `name` PARECE um telefone (só dígitos/símbolos, com
 * 6+ dígitos) — contatos com nome real não são alterados. Escolhe o título do
 * negócio MAIS RECENTE que tenha letras e não seja genérico ("Negócio ...").
 *
 * Uso:
 *   node --env-file=.env scripts/recover-contact-names-from-deal-title.mjs           # dry-run
 *   node --env-file=.env scripts/recover-contact-names-from-deal-title.mjs --apply   # aplica
 *   TARGET_ORG_ID=<org> ... (default: maior org)
 */
import { Client } from "pg";

const APPLY = process.argv.includes("--apply");
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

let orgId = process.env.TARGET_ORG_ID ?? null;
if (!orgId) {
  const r = await c.query(
    `SELECT "organizationId" FROM contacts GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`,
  );
  orgId = r.rows[0]?.organizationId ?? null;
}
if (!orgId) {
  console.error("Sem org.");
  process.exit(1);
}

// Condições reutilizadas
const NAME_IS_PHONE = `ct.name ~ '^[\\s+()\\-0-9]+$' AND ct.name ~ '[0-9]{6,}'`;
const TITLE_IS_REAL = `d.title ~ '[A-Za-zÀ-ÿ]' AND d.title !~ '^Neg[oó]cio'`;

// Candidatos: 1 título real (o mais recente) por contato-telefone.
const candidatesSql = `
  SELECT DISTINCT ON (d."contactId")
         d."contactId" AS contact_id, ct.name AS old_name, d.title AS new_name
    FROM deals d
    JOIN contacts ct ON ct.id = d."contactId"
   WHERE d."organizationId" = $1
     AND ${NAME_IS_PHONE}
     AND ${TITLE_IS_REAL}
   ORDER BY d."contactId", d."createdAt" DESC
`;

const preview = await c.query(candidatesSql, [orgId]);
console.log(`Modo: ${APPLY ? "APPLY (grava)" : "DRY-RUN"} | org=${orgId}`);
console.log(`Contatos que serão corrigidos: ${preview.rowCount}`);
console.log("\nAmostra (nome atual -> novo nome):");
for (const r of preview.rows.slice(0, 15)) {
  console.log(`  ${JSON.stringify(r.old_name)} -> ${JSON.stringify(r.new_name)}`);
}

if (APPLY) {
  const res = await c.query(
    `UPDATE contacts ct
        SET name = sub.new_name, "updatedAt" = now()
       FROM (${candidatesSql}) sub
      WHERE ct.id = sub.contact_id`,
    [orgId],
  );
  console.log(`\n✅ Atualizados: ${res.rowCount} contatos.`);
} else {
  console.log("\nDry-run: nada gravado. Rode com --apply para aplicar.");
}

await c.end();
