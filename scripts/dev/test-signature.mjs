import pkg from '@next/env';
pkg.loadEnvConfig(process.cwd());

import { createDecipheriv, createHmac } from 'node:crypto';
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

const testPayload = '{"object":"whatsapp_business_account","entry":[{"id":"test","changes":[]}]}';

for (const ch of channels) {
  const cfg = ch.config ?? {};
  const appSecret = cfg.appSecret ? decrypt(String(cfg.appSecret)) : null;

  if (!appSecret) { console.log('Sem appSecret'); continue; }

  console.log('\nCanal:', ch.name);
  console.log('appSecret length:', appSecret.length);
  console.log('appSecret chars:', appSecret.substring(0, 6) + '...' + appSecret.substring(appSecret.length - 4));

  // Gerar assinatura válida com o appSecret atual
  const hmac = createHmac('sha256', appSecret);
  hmac.update(testPayload);
  const validSignature = 'sha256=' + hmac.digest('hex');

  console.log('\nTestando POST com assinatura gerada pelo appSecret atual...');
  const res = await fetch(
    'https://crm-dev-backend.ca31ey.easypanel.host/api/webhooks/meta/teste-dev',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': validSignature,
      },
      body: testPayload,
    }
  );
  const text = await res.text();
  console.log('HTTP Status:', res.status);
  console.log('Resposta:', text);

  if (res.status === 200) {
    console.log('\n✅ appSecret CORRETO — assinatura validada com sucesso!');
  } else if (res.status === 401) {
    console.log('\n❌ appSecret ERRADO — assinatura ainda inválida!');
    console.log('   Verifique o App Secret no Meta: Settings → Basic → App Secret');
  }
}

await db.$disconnect();
