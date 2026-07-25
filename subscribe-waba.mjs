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
  // O provisionamento grava a WABA em `businessAccountId` (ver
  // src/services/channels-meta-provision.ts). Mantemos `wabaId` como
  // back-compat para configs antigos.
  const wabaId = cfg.businessAccountId ?? cfg.wabaId;

  if (!accessToken) { console.log('Sem accessToken'); continue; }
  if (!wabaId) { console.log('Sem businessAccountId/wabaId no config'); continue; }

  console.log('\nSubscrevendo app à WABA:', wabaId);

  const res = await fetch(
    `https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken })
    }
  );
  const data = await res.json();
  console.log('Status HTTP:', res.status);
  console.log('Resposta:', JSON.stringify(data, null, 2));

  if (data.success) {
    console.log('\n✅ App subscrito com sucesso à WABA!');
    console.log('Agora mensagens reais do WhatsApp devem chegar ao webhook.');
  } else {
    console.log('\n❌ Falha ao subscrever. Verifique o accessToken e permissões.');
  }
}

await db.$disconnect();
