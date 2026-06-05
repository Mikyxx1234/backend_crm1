import pkg from '@next/env';
pkg.loadEnvConfig(process.cwd());

import { createDecipheriv } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const PREFIX = 'enc:v1:';

function decrypt(value) {
  if (!value) return null;
  if (!value.startsWith(PREFIX)) return value;
  const key = Buffer.from(process.env.KEYRING_SECRET.trim(), 'base64');
  const buf = Buffer.from(value.slice(PREFIX.length), 'base64url');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

const channels = await db.channel.findMany({
  where: { provider: 'META_CLOUD_API' },
  select: { id: true, name: true, config: true }
});

for (const ch of channels) {
  const cfg = ch.config ?? {};
  const accessToken = cfg.accessToken ? decrypt(String(cfg.accessToken)) : null;
  const wabaId = cfg.wabaId ?? '945057281691135';

  if (!accessToken) { console.log('Sem accessToken'); continue; }

  console.log('\nCanal:', ch.name, '| WABA ID:', wabaId);
  console.log('AccessToken (início):', accessToken.substring(0, 20) + '...');

  // Verificar apps subscritos à WABA
  const url = `https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps?access_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();
  console.log('\nSubscribed Apps na WABA:');
  console.log(JSON.stringify(data, null, 2));
}

await db.$disconnect();
