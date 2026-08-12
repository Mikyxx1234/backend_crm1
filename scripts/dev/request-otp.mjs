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

console.log('Solicitando OTP via SMS para +55 11 94262-2310...');
console.log('(O código chegará por SMS no chip desse número)\n');

const res = await fetch(
  `https://graph.facebook.com/v20.0/${phoneId}/request_code`,
  {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code_method: 'SMS',
      language: 'pt_BR',
    }),
  }
);

const data = await res.json();
console.log('HTTP Status:', res.status);
console.log('Resposta:', JSON.stringify(data, null, 2));

if (data.success) {
  console.log('\n✅ OTP enviado via SMS!');
  console.log('Aguarde o SMS no celular com +55 11 94262-2310');
  console.log('Depois rode: node verify-otp.mjs XXXXXX  (substitua XXXXXX pelo código)');
} else {
  console.log('\n❌ Falha ao solicitar OTP');
}

await db.$disconnect();
