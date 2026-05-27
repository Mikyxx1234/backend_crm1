import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ log: [] });

const users = await prisma.user.findMany({ select: { email: true, isSuperAdmin: true, organizationId: true, id: true } });
const pipelines = await prisma.pipeline.findMany({ select: { id: true, name: true, isDefault: true } });
const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });

console.log("USERS:", JSON.stringify(users, null, 2));
console.log("PIPELINES:", JSON.stringify(pipelines, null, 2));
console.log("ORGS:", JSON.stringify(orgs, null, 2));

await prisma.$disconnect();
