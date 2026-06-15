/**
 * Verificações pós-migração no prod (read-only).
 *
 * Confirma que os backfills das 12 migrations criaram os artefatos
 * esperados para org_dnawork e org_eduit.
 */
import { Client } from "pg";
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const checks = [
  {
    label: "Catálogos por organização",
    query: `
      SELECT o.name AS org, c.name AS catalog, c."isDefault"
        FROM catalogs c
        JOIN organizations o ON o.id = c."organizationId"
       ORDER BY o.name, c.name
    `,
  },
  {
    label: "Capabilities ligadas ao catálogo default por org",
    query: `
      SELECT o.name AS org, cc."capabilityKey", cc."mode", cc.enabled
        FROM catalog_capabilities cc
        JOIN catalogs c ON c.id = cc."catalogId" AND c."isDefault" = true
        JOIN organizations o ON o.id = cc."organizationId"
       ORDER BY o.name, cc."capabilityKey"
    `,
  },
  {
    label: "Produtos da DNA com kind/catalogId setados",
    query: `
      SELECT p.id, p.name, p."type" AS legacy_type, p.kind, p."catalogId" IS NOT NULL AS has_catalog
        FROM products p
       WHERE p."organizationId" = 'org_dnawork'
       ORDER BY p.name
       LIMIT 20
    `,
  },
  {
    label: "Contacts da DNA — primeiros 5 com sequencial",
    query: `
      SELECT id, name, number
        FROM contacts
       WHERE "organizationId" = 'org_dnawork'
       ORDER BY number ASC
       LIMIT 5
    `,
  },
  {
    label: "Contacts da DNA — últimos 5 (maior number)",
    query: `
      SELECT id, name, number
        FROM contacts
       WHERE "organizationId" = 'org_dnawork'
       ORDER BY number DESC
       LIMIT 5
    `,
  },
  {
    label: "Contagem total de contatos numerados (DNA + EduIT)",
    query: `
      SELECT "organizationId", COUNT(*)::int AS total,
             MIN(number)::int AS min_n, MAX(number)::int AS max_n
        FROM contacts
       GROUP BY "organizationId"
       ORDER BY "organizationId"
    `,
  },
  {
    label: "Tabelas Group da DNA — devem estar vazias (criadas zeradas)",
    query: `
      SELECT 'groups' AS tabela, COUNT(*)::int AS rows FROM groups WHERE "organizationId"='org_dnawork'
      UNION ALL SELECT 'group_members', COUNT(*)::int FROM group_members WHERE "organizationId"='org_dnawork'
      UNION ALL SELECT 'group_permissions', COUNT(*)::int FROM group_permissions WHERE "organizationId"='org_dnawork'
      UNION ALL SELECT 'group_stage_grants', COUNT(*)::int FROM group_stage_grants WHERE "organizationId"='org_dnawork'
      UNION ALL SELECT 'group_field_grants', COUNT(*)::int FROM group_field_grants WHERE "organizationId"='org_dnawork'
    `,
  },
];

for (const ch of checks) {
  const r = await c.query(ch.query);
  console.log(`\n=== ${ch.label} (${r.rows.length} rows) ===`);
  console.table(r.rows);
}

await c.end();
