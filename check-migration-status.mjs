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

const [ch] = await db.channel.findMany({ where: { provider: 'META_CLOUD_API' }, select: { config: true } });
const token = decrypt(String(ch.config.accessToken));
const phoneId = ch.config.phoneNumberId ?? '1078521802020361';
const wabaId = ch.config.wabaId ?? '945057281691135';

// Todos os campos disponíveis do número
const r = await fetch(
  `https://graph.facebook.com/v20.0/${phoneId}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,status,name_status,platform_type,throughput,webhook_configuration,account_mode&access_token=${token}`
);
const phone = await r.json();
console.log('PHONE FULL:', JSON.stringify(phone, null, 2));

// Lista todos os números da WABA para comparar
const r2 = await fetch(
  `https://graph.facebook.com/v20.0/${wabaId}/phone_numbers?fields=id,display_phone_number,status,platform_type,verified_name&access_token=${token}`
);
const phones = await r2.json();
console.log('\nTODOS OS NÚMEROS DA WABA:', JSON.stringify(phones, null, 2));

await db.$disconnect();
