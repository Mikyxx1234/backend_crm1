import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Buscar usuário teste@eduit.com.br e sua organização
const user = await prisma.user.findFirst({
  where: { email: 'teste@eduit.com.br' },
  select: {
    id: true,
    email: true,
    role: true,
    organizationId: true,
    isSuperAdmin: true,
    organization: { select: { id: true, name: true, slug: true } }
  }
});

console.log('=== USUÁRIO ===');
console.log(JSON.stringify(user, null, 2));
console.log('\norganizationId:', user?.organizationId ?? 'NULL ← PROBLEMA!');

await prisma.$disconnect();
