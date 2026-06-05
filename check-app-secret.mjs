import pkg from '@next/env';
pkg.loadEnvConfig(process.cwd());

import { createDecipheriv } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const PREFIX = 'enc:v1:';

function decrypt(value) {
  if (!value) return null;
  if (!value.startsWith(PREFIX)) return `[plaintext: ${value.substring(0, 8)}...]`;
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
  const appSecret = cfg.appSecret ? decrypt(String(cfg.appSecret)) : null;
  console.log('\nCanal:', ch.name);
  console.log('  appSecret DECRIPTADO:', appSecret ? `${appSecret.substring(0, 6)}...${appSecret.substring(appSecret.length - 4)} (${appSecret.length} chars)` : 'NAO DEFINIDO');
}

await db.$disconnect();
