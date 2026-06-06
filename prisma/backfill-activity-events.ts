/**
 * Backfill: copia `deal_events` -> `activity_events`.
 *
 * Executar com:
 *   pnpm tsx prisma/backfill-activity-events.ts
 *
 * Idempotente: pula deal_events ja migrados (verifica por meta._backfillFromDealEventId).
 *
 * Mapeamento:
 *   - entityType   = "DEAL"
 *   - entityId     = dealEvent.dealId
 *   - dealId       = dealEvent.dealId
 *   - contactId    = deal.contactId (lookup)
 *   - entityLabel  = `Lead #${deal.number} ${deal.title}` (snapshot)
 *   - actorType    = derivado do user (AI->AI, ausente->SYSTEM, humano->HUMAN)
 *   - actorUserId  = dealEvent.userId
 *   - actorLabel   = user.name (snapshot na hora do backfill)
 *   - field/old/new = extraido de meta (chaves field/from/to convencionadas)
 *   - meta         = meta + { _backfillFromDealEventId: dealEvent.id }
 *   - occurredAt   = dealEvent.createdAt (preserva timeline historica)
 */

import { prismaBase } from "../src/lib/prisma-base";

type DealEventRow = {
  id: string;
  organizationId: string;
  dealId: string;
  userId: string | null;
  type: string;
  meta: Record<string, unknown> | null;
  createdAt: Date;
};

type DealRow = {
  contactId: string | null;
  number: number;
  title: string;
};

type UserRow = {
  name: string | null;
  type: "HUMAN" | "AI";
};

const BATCH_SIZE = 500;

function extractFieldOldNew(meta: Record<string, unknown> | null): {
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
} {
  if (!meta) return { field: null, oldValue: null, newValue: null };
  const field =
    typeof meta.field === "string"
      ? (meta.field as string)
      : typeof meta.fieldKey === "string"
        ? (meta.fieldKey as string)
        : null;
  const oldValue =
    meta.from !== undefined && meta.from !== null
      ? String(meta.from)
      : meta.oldValue !== undefined && meta.oldValue !== null
        ? String(meta.oldValue)
        : null;
  const newValue =
    meta.to !== undefined && meta.to !== null
      ? String(meta.to)
      : meta.newValue !== undefined && meta.newValue !== null
        ? String(meta.newValue)
        : null;
  return { field, oldValue, newValue };
}

async function main() {
  console.log("[backfill] starting deal_events -> activity_events migration");

  // 1) Conta o total e os ja migrados pra log de progresso.
  const totalDealEvents = await prismaBase.dealEvent.count();
  const alreadyMigrated = await prismaBase.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM activity_events
     WHERE meta ? '_backfillFromDealEventId'`,
  );
  console.log(
    `[backfill] deal_events total=${totalDealEvents}, ja migrados=${alreadyMigrated[0]?.count ?? 0n}`,
  );

  // 2) Cache de deals e users (poucos comparado a # de eventos).
  const dealCache = new Map<string, DealRow | null>();
  const userCache = new Map<string, UserRow | null>();

  async function fetchDeal(dealId: string): Promise<DealRow | null> {
    if (dealCache.has(dealId)) return dealCache.get(dealId) ?? null;
    const d = await prismaBase.deal.findUnique({
      where: { id: dealId },
      select: { contactId: true, number: true, title: true },
    });
    dealCache.set(dealId, d);
    return d;
  }
  async function fetchUser(userId: string): Promise<UserRow | null> {
    if (userCache.has(userId)) return userCache.get(userId) ?? null;
    const u = await prismaBase.user.findUnique({
      where: { id: userId },
      select: { name: true, type: true },
    });
    userCache.set(userId, u);
    return u;
  }

  // 3) Loop em batches por createdAt asc (ordem cronologica).
  let cursor: { createdAt: Date; id: string } | null = null;
  let migrated = 0;
  let skipped = 0;

  while (true) {
    const where = cursor
      ? {
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        }
      : {};

    const batch = (await prismaBase.dealEvent.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
    })) as DealEventRow[];

    if (batch.length === 0) break;

    for (const ev of batch) {
      // skip se ja migrado (idempotencia)
      const exists = await prismaBase.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM activity_events
         WHERE meta @> $1::jsonb
         LIMIT 1`,
        JSON.stringify({ _backfillFromDealEventId: ev.id }),
      );
      if (exists.length > 0) {
        skipped += 1;
        continue;
      }

      const deal = await fetchDeal(ev.dealId);
      const user = ev.userId ? await fetchUser(ev.userId) : null;

      // Resolve ator
      let actorType: "HUMAN" | "AI" | "SYSTEM" = "SYSTEM";
      let actorLabel: string | null = "Sistema";
      let actorUserId: string | null = null;
      if (user) {
        actorUserId = ev.userId;
        actorLabel = user.name ?? null;
        actorType = user.type === "AI" ? "AI" : "HUMAN";
      }

      const entityLabel = deal
        ? `Lead #${deal.number} - ${deal.title}`.slice(0, 240)
        : `Lead ${ev.dealId}`;

      const { field, oldValue, newValue } = extractFieldOldNew(ev.meta);

      const mergedMeta = {
        ...(ev.meta ?? {}),
        _backfillFromDealEventId: ev.id,
      };

      try {
        await prismaBase.activityEvent.create({
          data: {
            organizationId: ev.organizationId,
            occurredAt: ev.createdAt,
            type: ev.type,
            entityType: "DEAL",
            entityId: ev.dealId,
            entityLabel,
            dealId: ev.dealId,
            contactId: deal?.contactId ?? null,
            actorType,
            actorUserId,
            actorLabel,
            field,
            oldValue,
            newValue,
            meta: mergedMeta,
          },
        });
        migrated += 1;
      } catch (err) {
        console.warn(
          `[backfill] skip dealEvent ${ev.id}: ${err instanceof Error ? err.message : err}`,
        );
        skipped += 1;
      }
    }

    const last = batch[batch.length - 1];
    cursor = { createdAt: last.createdAt, id: last.id };
    console.log(`[backfill] migrated=${migrated} skipped=${skipped}`);
  }

  console.log(
    `[backfill] DONE. migrated=${migrated} skipped=${skipped} total=${totalDealEvents}`,
  );
  await prismaBase.$disconnect();
}

main().catch((err) => {
  console.error("[backfill] FATAL:", err);
  process.exit(1);
});
