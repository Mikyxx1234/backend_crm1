/**
 * Backup defensivo do banco de produção antes de aplicar as 12 migrations.
 *
 * NÃO é um pg_dump completo (faltam triggers, functions, sequences extras
 * fora do uso normal Prisma). É um backup de DADOS robusto e restaurável,
 * suficiente como rede de segurança para operações aditivas como esta:
 *
 *   - Para CADA tabela do schema `public` (exceto _prisma_migrations),
 *     salva os dados em formato `COPY ... FROM stdin;` igual ao que
 *     pg_dump --data-only produz. O arquivo gerado é REPLAYÁVEL via psql.
 *   - Salva também: lista de migrations atuais, currval de cada sequence,
 *     lista de tabelas e colunas (snapshot do schema).
 *
 * Restauração (se precisar):
 *   1. Criar database vazio + aplicar migrations até o ponto desejado
 *      (basta rodar prisma migrate deploy num clone do schema atual).
 *   2. `psql ... -f backup-data.sql` (vai inserir os COPY).
 *
 * Uso:
 *   $env:DATABASE_URL = "postgres://...";
 *   node scripts/dev/backup-prod-data.mjs ./backups/prod-2026-06-15
 */
import { Client } from "pg";
import { to as copyTo } from "pg-copy-streams";
import { mkdir, writeFile, open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌ DATABASE_URL não setado.");
  process.exit(1);
}

const outDir = process.argv[2];
if (!outDir) {
  console.error("Uso: node scripts/dev/backup-prod-data.mjs <diretório>");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

const c = new Client({ connectionString: url });
await c.connect();

const startedAt = new Date();

try {
  // 1. Lista tabelas do schema public (exceto _prisma_migrations e
  //    PARTITIONED TABLES — Postgres não permite COPY da parent table.
  //    As partições filhas (relkind='r') são listadas normalmente e cobrem
  //    100% dos dados.
  const tables = (
    await c.query(`
      SELECT n.nspname AS schema_name, c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'                  -- ordinary tables (inclui partições filhas)
         AND c.relname <> '_prisma_migrations'
       ORDER BY c.relname
    `)
  ).rows.map((r) => r.table_name);

  const partitionedSkipped = (
    await c.query(`
      SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'p'                  -- partitioned tables (parents)
       ORDER BY c.relname
    `)
  ).rows.map((r) => r.table_name);

  console.log(`Encontradas ${tables.length} tabelas para fazer backup.`);
  if (partitionedSkipped.length > 0) {
    console.log(
      `  (parents particionados ignorados — dados ficam nas filhas: ${partitionedSkipped.join(", ")})`,
    );
  }

  // 2. Sequences atuais (nextval restore)
  const sequences = (
    await c.query(`
      SELECT sequence_schema, sequence_name
        FROM information_schema.sequences
       WHERE sequence_schema = 'public'
       ORDER BY sequence_name
    `)
  ).rows;
  const seqValues = [];
  for (const s of sequences) {
    try {
      const v = (
        await c.query(`SELECT last_value, is_called FROM "${s.sequence_name}"`)
      ).rows[0];
      seqValues.push({ name: s.sequence_name, ...v });
    } catch {
      // sequence sem rows (ex: nunca usada) — ignora
    }
  }

  // 3. Snapshot das colunas (para diff/comparação caso precise restaurar)
  const columns = (
    await c.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position
    `)
  ).rows;

  // 4. Migrations registradas
  const migrations = (
    await c.query(`SELECT * FROM _prisma_migrations ORDER BY started_at`)
  ).rows;

  await writeFile(
    path.join(outDir, "metadata.json"),
    JSON.stringify(
      {
        databaseUrl: url.replace(/:[^@/]+@/, ":****@"),
        startedAt: startedAt.toISOString(),
        tables,
        sequences: seqValues,
        columns,
        migrationsCount: migrations.length,
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(outDir, "_prisma_migrations.json"),
    JSON.stringify(migrations, null, 2),
  );

  // 5. Para cada tabela: COPY TO file usando pg-copy-streams
  const dataFile = path.join(outDir, "data.sql");
  const fh = await open(dataFile, "w");
  try {
    await fh.write(
      `-- Backup defensivo de dados (formato pg_dump --data-only).\n` +
        `-- DB: ${url.replace(/:[^@/]+@/, ":****@")}\n` +
        `-- Gerado em: ${startedAt.toISOString()}\n` +
        `-- Tabelas: ${tables.length}\n\n` +
        `SET session_replication_role = replica;\n\n`,
    );

    let totalRows = 0;
    for (const t of tables) {
      // Conta linhas pra log
      const cnt = (
        await c.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)
      ).rows[0].n;

      await fh.write(`-- Tabela: ${t} (${cnt} linhas)\n`);

      if (cnt === 0) {
        await fh.write(`-- (vazia — sem COPY)\n\n`);
        console.log(`  ${t}: 0 linhas (skip)`);
        continue;
      }

      // Pega lista de colunas explicitamente para evitar dependência de ordem
      const cols = (
        await c.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1
            ORDER BY ordinal_position`,
          [t],
        )
      ).rows.map((r) => `"${r.column_name}"`);
      const colList = cols.join(", ");

      await fh.write(
        `COPY "${t}" (${colList}) FROM stdin WITH (FORMAT text);\n`,
      );

      // Pipe COPY TO STDOUT para o arquivo
      const stream = c.query(
        copyTo(
          `COPY "${t}" (${colList}) TO STDOUT WITH (FORMAT text)`,
        ),
      );
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buf = Buffer.concat(chunks);
      await fh.write(buf);
      await fh.write(`\\.\n\n`);

      totalRows += cnt;
      console.log(`  ${t}: ${cnt} linhas (${(buf.length / 1024).toFixed(1)} KB)`);
    }

    // 6. Resync sequences ao final
    if (seqValues.length > 0) {
      await fh.write(`-- Resync de sequences\n`);
      for (const s of seqValues) {
        await fh.write(
          `SELECT pg_catalog.setval('public."${s.name}"', ${s.last_value}, ${s.is_called});\n`,
        );
      }
      await fh.write(`\n`);
    }

    await fh.write(`SET session_replication_role = DEFAULT;\n`);

    console.log(
      `\n✔ Backup completo: ${totalRows} linhas em ${tables.length} tabelas`,
    );
    console.log(`   Arquivo: ${dataFile}`);
    console.log(`   Metadata: ${path.join(outDir, "metadata.json")}`);
  } finally {
    await fh.close();
  }
} catch (e) {
  console.error("❌ Erro:", e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  await c.end();
}
