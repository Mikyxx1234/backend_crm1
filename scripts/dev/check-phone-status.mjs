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
  const phoneNumberId = cfg.phoneNumberId ?? '1078521802020361';
  const wabaId = cfg.businessAccountId ?? cfg.wabaId;

  if (!accessToken) continue;

  // Status do número de telefone
  const r1 = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}?fields=display_phone_number,verified_name,code_verification_status,quality_rating,status,name_status,messaging_limit_tier&access_token=${accessToken}`
  );
  const phone = await r1.json();
  console.log('\n=== STATUS DO NÚMERO ===');
  console.log(JSON.stringify(phone, null, 2));

  // Health da WABA
  const r2 = await fetch(
    `https://graph.facebook.com/v20.0/${wabaId}?fields=id,name,currency,message_template_namespace,on_behalf_of_business_info,owner_business_info,primary_funding_id,status&access_token=${accessToken}`
  );
  const waba = await r2.json();
  console.log('\n=== STATUS DA WABA ===');
  console.log(JSON.stringify(waba, null, 2));
}

await db.$disconnect();
