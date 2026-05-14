// Lista todos os users e organizations relacionados a DNA WORK.
import { Client } from "pg";
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL não setado."); process.exit(1); }

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

console.log("=== Organizations contendo 'dna' (case-insensitive) ===");
const orgs = (await c.query(
  `SELECT id, name, slug, status, "createdAt" FROM organizations
   WHERE LOWER(name) LIKE '%dna%' OR LOWER(slug) LIKE '%dna%'
   ORDER BY "createdAt" DESC`,
)).rows;
console.table(orgs);

console.log("\n=== Users com email contendo 'dna' ou 'dnawork' ===");
const users = (await c.query(
  `SELECT id, email, name, role, type, "isErased", "organizationId", "isSuperAdmin", "createdAt"
   FROM users
   WHERE LOWER(email) LIKE '%dna%' OR LOWER(name) LIKE '%dna%'
   ORDER BY "createdAt" DESC`,
)).rows;
console.table(users);

if (orgs.length) {
  for (const o of orgs) {
    console.log(`\n=== Users da org '${o.name}' (${o.id}) ===`);
    const u = (await c.query(
      `SELECT id, email, name, role, type, "isErased", "createdAt"
       FROM users WHERE "organizationId" = $1 ORDER BY "createdAt" ASC`, [o.id],
    )).rows;
    console.table(u);
  }
}

await c.end();
