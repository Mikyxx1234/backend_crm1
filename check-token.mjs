import pkg from '@next/env';
pkg.loadEnvConfig(process.cwd());
import { createDecipheriv } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const PREFIX = 'enc:v1:';

function decrypt(v) {
  if (!v) return null;
  if (!v.startsWith(PREFIX)) return v;
  const key = Buffer.from(process.env.KEYRING_SECRET.trim(), 'base64');
  const buf = Buffer.from(v.slice(PREFIX.length), 'base64url');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(authTag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

const [ch] = await db.channel.findMany({
  where: { provider: 'META_CLOUD_API' },
  select: { config: true }
});

const token = decrypt(String(ch.config.accessToken));
const phoneNumberId = ch.config.phoneNumberId ?? '1078521802020361';
const wabaId = ch.config.wabaId ?? '945057281691135';
const appId = ch.config.appId;

console.log('=== TOKEN DEBUG ===');
const r1 = await fetch(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`);
const tokenInfo = await r1.json();
console.log(JSON.stringify(tokenInfo, null, 2));

console.log('\n=== STATUS DO NÚMERO (detalhado) ===');
const r2 = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,status,name_status,messaging_limit_tier,platform_type,throughput,webhook_configuration&access_token=${token}`);
console.log(JSON.stringify(await r2.json(), null, 2));

console.log('\n=== REGISTRO DO NÚMERO ===');
const r3 = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}?fields=id,status&access_token=${token}`);
console.log(JSON.stringify(await r3.json(), null, 2));

await db.$disconnect();
