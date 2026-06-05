import pkg from '@next/env';
pkg.loadEnvConfig(process.cwd());
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const events = await db.metaWebhookEvent.findMany({
  orderBy: { receivedAt: 'desc' },
  take: 10,
  select: {
    id: true,
    receivedAt: true,
    processed: true,
    objectType: true,
    eventType: true,
    rawBody: true,
  }
});

console.log(`Total de eventos recentes: ${events.length}`);
for (const e of events) {
  const body = e.rawBody;
  const object = body?.object ?? '?';
  const entries = body?.entry ?? [];
  console.log(`\n[${e.receivedAt?.toISOString()}] processed=${e.processed} | object=${object} | entries=${entries.length}`);
  console.log('  RAW:', JSON.stringify(body, null, 2).substring(0, 800));
}

await db.$disconnect();
