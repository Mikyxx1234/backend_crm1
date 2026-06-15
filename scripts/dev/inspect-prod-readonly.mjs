/**
 * Fase 0 da migração DEV_BRANCH → main.
 *
 * Inspeção 100% READ-ONLY no banco de produção. NÃO faz INSERT/UPDATE/ALTER.
 *
 * O que cobre:
 *   1. Versão do Postgres
 *   2. Lista de migrations Prisma já aplicadas (_prisma_migrations)
 *   3. Existência de colunas e tabelas chave (products.type, products.kind,
 *      contacts.number, channels.defaultPipelineId, roles.inheritsFrom,
 *      catalogs, groups, etc.) — para detectar hotfixes manuais.
 *   4. Listar org DNA: id, slug, contagem de users por role,
 *      contagem de roles, contagem de produtos.
 *   5. Permissions atuais dos preset MANAGER e MEMBER da DNA.
 *
 * Uso:
 *   $env:DATABASE_URL = "postgres://...";
 *   node scripts/dev/inspect-prod-readonly.mjs
 */
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌ DATABASE_URL não setado.");
  process.exit(1);
}

const c = new Client({ connectionString: url });
await c.connect();

const log = (label, value) =>
  console.log(`\n=== ${label} ===\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`);

try {
  // 1. Versão
  const ver = (await c.query("SELECT version()")).rows[0].version;
  log("PostgreSQL version", ver);

  // 2. Migrations aplicadas
  const mig = (
    await c.query(
      `SELECT migration_name,
              finished_at IS NOT NULL AS applied,
              rolled_back_at IS NOT NULL AS rolled_back,
              applied_steps_count
         FROM _prisma_migrations
         ORDER BY started_at`,
    )
  ).rows;
  log(`_prisma_migrations (${mig.length} total)`, mig.map((m) => ({
    name: m.migration_name,
    applied: m.applied,
    rolled_back: m.rolled_back,
  })));

  // Verifica quais das 11 migrations da DEV_BRANCH JÁ estão registradas:
  const targetNames = [
    "20260611200000_products_multitype",
    "20260611210000_inventory_pool_product_optional",
    "20260612000000_contact_sequential_number",
    "20260612190000_add_channel_default_pipeline",
    "20260612200000_add_contact_tags",
    "20260613130000_catalog_capabilities",
    "20260613140000_event_entity_product",
    "20260614130000_capability_mode_overrides",
    "20260614140000_flow_short_id",
    "20260615120000_role_inherits_from",
    "20260615120100_groups_kommo",
  ];
  const appliedSet = new Set(mig.filter((m) => m.applied && !m.rolled_back).map((m) => m.migration_name));
  const status = targetNames.map((n) => ({
    migration: n,
    in_prisma_table: appliedSet.has(n),
  }));
  log("Status das 11 migrations alvo", status);

  // 3. Verifica colunas/tabelas chave que cada migration adiciona — detecta
  //    se aplicação manual (hotfix) já foi feita sem registrar em _prisma_migrations.
  const probes = [
    { kind: "column", table: "products", column: "type", from: "main (legacy)" },
    { kind: "column", table: "products", column: "kind", from: "products_multitype" },
    { kind: "column", table: "products", column: "catalogId", from: "catalog_capabilities" },
    { kind: "column", table: "companies", column: "parentId", from: "products_multitype" },
    { kind: "column", table: "contacts", column: "number", from: "contact_sequential_number" },
    { kind: "column", table: "channels", column: "defaultPipelineId", from: "add_channel_default_pipeline" },
    { kind: "column", table: "deals", column: "dealRole", from: "catalog_capabilities" },
    { kind: "column", table: "roles", column: "inheritsFrom", from: "role_inherits_from" },
    { kind: "column", table: "whatsapp_flow_definitions", column: "short_id", from: "flow_short_id" },
    { kind: "column", table: "catalog_capabilities", column: "mode", from: "capability_mode_overrides" },
    { kind: "table", table: "tags_on_contacts", from: "add_contact_tags" },
    { kind: "table", table: "catalogs", from: "catalog_capabilities" },
    { kind: "table", table: "catalog_capabilities", from: "catalog_capabilities" },
    { kind: "table", table: "product_capabilities", from: "catalog_capabilities" },
    { kind: "table", table: "capacity_slots", from: "catalog_capabilities" },
    { kind: "table", table: "shipping_ranges", from: "catalog_capabilities" },
    { kind: "table", table: "stakeholder_rules", from: "catalog_capabilities" },
    { kind: "table", table: "deal_links", from: "catalog_capabilities" },
    { kind: "table", table: "org_units", from: "products_multitype" },
    { kind: "table", table: "product_offers", from: "products_multitype" },
    { kind: "table", table: "inventory_pools", from: "products_multitype" },
    { kind: "table", table: "inventory_movements", from: "products_multitype" },
    { kind: "table", table: "product_shipping", from: "products_multitype" },
    { kind: "table", table: "product_plans", from: "products_multitype" },
    { kind: "table", table: "course_configs", from: "products_multitype" },
    { kind: "table", table: "course_classes", from: "products_multitype" },
    { kind: "table", table: "job_openings", from: "products_multitype" },
    { kind: "table", table: "product_stakeholders", from: "products_multitype" },
    { kind: "table", table: "groups", from: "groups_kommo" },
    { kind: "table", table: "group_members", from: "groups_kommo" },
    { kind: "table", table: "group_permissions", from: "groups_kommo" },
    { kind: "table", table: "group_stage_grants", from: "groups_kommo" },
    { kind: "table", table: "group_field_grants", from: "groups_kommo" },
  ];

  const probeResults = [];
  for (const p of probes) {
    if (p.kind === "column") {
      const r = await c.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [p.table, p.column],
      );
      probeResults.push({ ...p, exists: r.rowCount > 0 });
    } else {
      const r = await c.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1`,
        [p.table],
      );
      probeResults.push({ ...p, exists: r.rowCount > 0 });
    }
  }
  log("Probes de schema (estado atual do prod)", probeResults);

  // 4. Org DNA
  const orgs = (
    await c.query(
      `SELECT id, name, slug FROM organizations ORDER BY "createdAt" ASC LIMIT 20`,
    )
  ).rows;
  log("organizations (top 20)", orgs);

  const dna = orgs.find((o) => /dna/i.test(o.name) || /dna/i.test(o.slug ?? ""));
  if (!dna) {
    console.warn("⚠️  Org DNA não localizada por nome/slug — apenas continuo sem dados específicos.");
  } else {
    log("DNA encontrada", dna);

    const usersByRole = (
      await c.query(
        `SELECT role, COUNT(*)::int AS qtd
           FROM users WHERE "organizationId" = $1
          GROUP BY role
          ORDER BY role`,
        [dna.id],
      )
    ).rows;
    log("DNA — users por role (enum legacy)", usersByRole);

    const roles = (
      await c.query(
        `SELECT id, name, "systemPreset", "isSystem", array_length(permissions, 1) AS qtd_perms
           FROM roles WHERE "organizationId" = $1
          ORDER BY "systemPreset" NULLS LAST, name`,
        [dna.id],
      )
    ).rows;
    log("DNA — roles", roles);

    const ura = (
      await c.query(
        `SELECT COUNT(*)::int AS total
           FROM user_role_assignments WHERE "organizationId" = $1`,
        [dna.id],
      )
    ).rows[0];
    log("DNA — user_role_assignments", ura);

    // 5. Permissions atuais dos presets MANAGER e MEMBER da DNA
    const managerRow = (
      await c.query(
        `SELECT id, name, permissions FROM roles
          WHERE "organizationId" = $1 AND "systemPreset" = 'MANAGER' LIMIT 1`,
        [dna.id],
      )
    ).rows[0];
    log("DNA — preset MANAGER", managerRow ?? null);

    const memberRow = (
      await c.query(
        `SELECT id, name, permissions FROM roles
          WHERE "organizationId" = $1 AND "systemPreset" = 'MEMBER' LIMIT 1`,
        [dna.id],
      )
    ).rows[0];
    log("DNA — preset MEMBER", memberRow ?? null);

    // 6. Diff: quais permissions novas faltam em cada preset
    const NEW_MANAGER = [
      "product:manage_offers", "product:manage_stakeholders",
      "inventory:view", "inventory:adjust",
      "job_opening:view", "job_opening:manage", "job_opening:close",
      "org_unit:view", "org_unit:manage",
      "catalog:view", "catalog:create", "catalog:edit_capabilities",
      "catalog:delete", "catalog:save_as_template",
    ];
    const NEW_MEMBER = [
      "product:view",
      "inventory:view",
      "job_opening:view",
      "org_unit:view",
      "catalog:view",
    ];

    if (managerRow) {
      const has = new Set(managerRow.permissions ?? []);
      log(
        "DNA — permissions novas que faltam no preset MANAGER",
        NEW_MANAGER.filter((k) => !has.has(k) && !has.has("*")),
      );
    }
    if (memberRow) {
      const has = new Set(memberRow.permissions ?? []);
      log(
        "DNA — permissions novas que faltam no preset MEMBER",
        NEW_MEMBER.filter((k) => !has.has(k) && !has.has("*")),
      );
    }

    // 7. Custom roles (não-presets) — para garantir que o backfill não os afete
    const customRoles = (
      await c.query(
        `SELECT id, name, "systemPreset", array_length(permissions, 1) AS qtd_perms
           FROM roles
          WHERE "organizationId" = $1 AND "systemPreset" IS NULL
          ORDER BY name`,
        [dna.id],
      )
    ).rows;
    log(`DNA — custom roles (não-presets): ${customRoles.length}`, customRoles);

    // 8. Volumetria que vai ser tocada por backfills
    const counts = (
      await c.query(
        `SELECT
           (SELECT COUNT(*)::int FROM products WHERE "organizationId" = $1) AS produtos,
           (SELECT COUNT(*)::int FROM contacts WHERE "organizationId" = $1) AS contatos,
           (SELECT COUNT(*)::int FROM deals    WHERE "organizationId" = $1) AS negocios,
           (SELECT COUNT(*)::int FROM channels WHERE "organizationId" = $1) AS canais,
           (SELECT COUNT(*)::int FROM users    WHERE "organizationId" = $1) AS usuarios`,
        [dna.id],
      )
    ).rows[0];
    log("DNA — volumetria", counts);
  }

  console.log("\n✔ Inspeção read-only finalizada — nenhuma alteração feita.");
} catch (e) {
  console.error("\n❌ Erro na inspeção:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
