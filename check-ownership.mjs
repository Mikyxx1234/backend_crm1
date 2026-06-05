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
const appId = ch.config.appId;

console.log('=== APPS SUBSCRITOS NA WABA ===');
const r1 = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps?access_token=${token}`);
console.log(JSON.stringify(await r1.json(), null, 2));

console.log('\n=== WEBHOOK DO NÚMERO (qual URL está recebendo agora) ===');
const r2 = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=webhook_configuration&access_token=${token}`);
console.log(JSON.stringify(await r2.json(), null, 2));

console.log('\n=== APP ID no banco:', appId ?? 'NÃO CONFIGURADO', '===');
console.log('App ID do token: 2193930808098836 (visível nos logs)');

await db.$disconnect();
