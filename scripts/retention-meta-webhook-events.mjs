/**
 * Retenção opt-in de meta_webhook_events.
 *
 * Dry-run (default): só imprime contagens.
 *   node --env-file=.env scripts/retention-meta-webhook-events.mjs
 *   node --env-file=.env scripts/retention-meta-webhook-events.mjs --days=90
 *
 * Executar deletes (exige --apply):
 *   node --env-file=.env scripts/retention-meta-webhook-events.mjs --days=60 --apply
 *
 * activity_events: use partições
 *   pnpm tsx src/scripts/activity-events-partitions.ts --retention=2
 */
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const KEEP_DAYS = Math.max(
  30,
  Number.parseInt(daysArg?.split("=")[1] ?? "60", 10) || 60,
);
const BATCH = 5000;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definido.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const preview = await client.query(
    `SELECT
       COUNT(*)::bigint AS total_rows,
       COUNT(*) FILTER (WHERE "receivedAt" < now() - ($1::text || ' days')::interval)::bigint AS older,
       MIN("receivedAt") AS oldest,
       MAX("receivedAt") AS newest
     FROM meta_webhook_events`,
    [String(KEEP_DAYS)],
  );
  const row = preview.rows[0];
  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "APPLY" : "DRY-RUN",
        keepDays: KEEP_DAYS,
        totalRows: row.total_rows,
        olderThanKeep: row.older,
        oldest: row.oldest,
        newest: row.newest,
      },
      null,
      2,
    ),
  );

  if (!APPLY) {
    console.log("Dry-run ok. Passe --apply para apagar em lotes.");
    process.exit(0);
  }

  let deleted = 0;
  for (;;) {
    const res = await client.query(
      `WITH doomed AS (
         SELECT id FROM meta_webhook_events
         WHERE "receivedAt" < now() - ($1::text || ' days')::interval
         ORDER BY "receivedAt"
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM meta_webhook_events m
       USING doomed d
       WHERE m.id = d.id
       RETURNING m.id`,
      [String(KEEP_DAYS), BATCH],
    );
    if (res.rowCount === 0) break;
    deleted += res.rowCount;
    console.log(`deleted_batch=${res.rowCount} total=${deleted}`);
  }
  console.log(`done deleted=${deleted}`);
} finally {
  await client.end();
}
