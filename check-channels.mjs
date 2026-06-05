import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const channels = await prisma.channel.findMany({
  select: {
    id: true,
    name: true,
    type: true,
    status: true,
    webhookUrl: true,
    organization: { select: { name: true, slug: true } }
  }
});
console.log(JSON.stringify(channels, null, 2));
await prisma.$disconnect();
