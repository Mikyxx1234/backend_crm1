import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Todos os canais
const channels = await prisma.channel.findMany({
  select: {
    id: true,
    name: true,
    type: true,
    provider: true,
    status: true,
    phoneNumber: true,
    config: true,
    organization: { select: { name: true, slug: true } }
  }
});

console.log('=== CANAIS CADASTRADOS ===');
for (const ch of channels) {
  console.log(`\nCanal: "${ch.name}"`);
  console.log(`  Org: ${ch.organization.slug}`);
  console.log(`  Tipo: ${ch.type} | Provider: ${ch.provider}`);
  console.log(`  Status: ${ch.status}`);
  console.log(`  Telefone: ${ch.phoneNumber ?? 'N/A'}`);
  const cfg = typeof ch.config === 'string' ? JSON.parse(ch.config) : (ch.config ?? {});
  // Mostrar apenas chaves relevantes
  const show = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (!k.toLowerCase().includes('token') && !k.toLowerCase().includes('secret')) {
      show[k] = v;
    } else {
      show[k] = typeof v === 'string' ? `${String(v).slice(0, 8)}...` : v;
    }
  }
  console.log(`  Config:`, JSON.stringify(show, null, 4));
}

// Últimos eventos webhook
const events = await prisma.metaWebhookEvent.findMany({
  take: 5,
  orderBy: { createdAt: 'desc' },
  select: { id: true, type: true, status: true, createdAt: true }
});
console.log('\n=== ÚLTIMOS EVENTOS META WEBHOOK ===');
if (events.length === 0) {
  console.log('⚠️  NENHUM evento recebido! O webhook da Meta não está chegando.');
} else {
  events.forEach(e => console.log(JSON.stringify(e)));
}

await prisma.$disconnect();
