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

const ourWebhookUrl = 'https://crm-dev-backend.ca31ey.easypanel.host/api/webhooks/meta/teste-dev';

// 1. Verificar quais apps estão subscritos à WABA agora
console.log('=== APPS SUBSCRITOS AGORA ===');
const r0 = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps?access_token=${token}`);
console.log(JSON.stringify(await r0.json(), null, 2));

// 2. Tentar desregistrar e re-registrar o número para forçar o webhook correto
console.log('\n=== DEREGISTRANDO número para resetar webhook ===');
const r1 = await fetch(
  `https://graph.facebook.com/v20.0/${phoneId}/deregister`,
  {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }
);
console.log('Deregister:', r1.status, JSON.stringify(await r1.json()));

await new Promise(r => setTimeout(r, 3000));

// 3. Re-registrar para que nossa subscrição WABA defina o webhook
console.log('\n=== RE-REGISTRANDO número ===');
const r2 = await fetch(
  `https://graph.facebook.com/v20.0/${phoneId}/register`,
  {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin: '123456' })
  }
);
console.log('Register:', r2.status, JSON.stringify(await r2.json()));

await new Promise(r => setTimeout(r, 2000));

// 4. Verificar novo status
const r3 = await fetch(
  `https://graph.facebook.com/v20.0/${phoneId}?fields=status,platform_type,webhook_configuration&access_token=${token}`
);
const status = await r3.json();
console.log('\n=== STATUS FINAL ===');
console.log(JSON.stringify(status, null, 2));

if (status.webhook_configuration?.application?.includes('crm-dev-backend')) {
  console.log('\n✅ Webhook corrigido para nosso backend!');
} else {
  console.log('\n⚠️  Webhook:', status.webhook_configuration?.application);
}

await db.$disconnect();
