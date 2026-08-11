import { createDecipheriv } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import pkg from '@next/env';
pkg.loadEnvConfig(process.cwd());

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:v1:';

function getKey() {
  const raw = process.env.KEYRING_SECRET?.trim();
  if (!raw) throw new Error('KEYRING_SECRET não definido');
  return Buffer.from(raw, 'base64');
}

function decryptSecret(value) {
  if (!value || !value.startsWith(PREFIX)) return value;
  const payload = value.slice(PREFIX.length);
  const combined = Buffer.from(payload, 'base64url');
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

const prisma = new PrismaClient();
const channel = await prisma.channel.findFirst({
  where: { provider: 'META_CLOUD_API' },
  select: { id: true, name: true, config: true, organization: { select: { slug: true } } }
});

if (!channel) {
  console.log('Nenhum canal META encontrado!');
} else {
  const cfg = channel.config;
  console.log(`\n====================================================`);
  console.log(`Canal: ${channel.name} | Org: ${channel.organization.slug}`);
  console.log(`====================================================`);
  
  try {
    const verifyToken = decryptSecret(cfg.verifyToken);
    console.log(`\n✅ Verify Token (copie para a Meta): ${verifyToken}`);
  } catch (e) {
    console.log(`❌ Erro ao descriptografar verifyToken: ${e.message}`);
  }

  console.log(`\n📌 Phone Number ID: ${cfg.phoneNumberId}`);
  console.log(`📌 Business Account ID: ${cfg.businessAccountId}`);
  
  const orgSlug = channel.organization.slug;
  console.log(`\n🔗 URL do Webhook para configurar na Meta:`);
  console.log(`   https://crm-dev-frontend.ca31ey.easypanel.host/api/webhooks/meta/${orgSlug}`);
  console.log(`\n⚙️  Campos a assinar na Meta (Webhook Fields):`);
  console.log(`   ✅ messages`);
}

await prisma.$disconnect();
