import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const channels = await db.channel.findMany({
  where: { provider: 'META_CLOUD_API' },
  select: { id: true, name: true, type: true, provider: true, status: true, config: true, organizationId: true }
});

for (const ch of channels) {
  const cfg = ch.config ?? {};
  console.log('\n========================================');
  console.log('Canal:', ch.id, '|', ch.name, '| Status:', ch.status);
  console.log('  appId:', cfg.appId ?? 'NAO DEFINIDO');
  console.log('  appSecret:', cfg.appSecret ? `SIM (${String(cfg.appSecret).substring(0, 10)}...)` : 'NAO DEFINIDO');
  console.log('  accessToken:', cfg.accessToken ? `SIM (${String(cfg.accessToken).substring(0, 10)}...)` : 'NAO DEFINIDO');
  console.log('  verifyToken:', cfg.verifyToken ? `SIM (${String(cfg.verifyToken).substring(0, 10)}...)` : 'NAO DEFINIDO');
  console.log('  phoneNumberId:', cfg.phoneNumberId ?? 'NAO DEFINIDO');
  console.log('  businessAccountId:', cfg.businessAccountId ?? cfg.wabaId ?? 'NAO DEFINIDO');
}

await db.$disconnect();
