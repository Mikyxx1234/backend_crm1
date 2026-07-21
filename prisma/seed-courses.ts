/**
 * Seed do cenário mockado de Catálogo de Cursos + Cotas por Unidade.
 *
 * Idempotente: pode ser rodado múltiplas vezes. Usa `upsert` por chaves
 * naturais (org + nome) para evitar duplicatas.
 *
 * Cria:
 *   - 2 Unidades (Barra Funda, Sapopemba)
 *   - 2 Cursos (Administração EaD R$200 / Pedagogia HYBRID R$200)
 *   - 6 Categorias de Desconto:
 *       Balcão 25% / Estratégico 30% / Mar Aberto 10% /
 *       Transferência 20% / 2ª Graduação 20% / Empresas Conveniadas 35%
 *   - Alocações (DiscountQuota) por (categoria × unidade):
 *       BF Balcão=50, BF Estratégico=10
 *       Sapopemba Balcão=35, Sapopemba Estratégico=7
 *       (demais categorias: 20 por unidade — placeholder)
 *
 * Uso:
 *   SEED_ORG_ID=org_eduit npx tsx prisma/seed-courses.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORG_ID = process.env.SEED_ORG_ID?.trim() || "org_eduit";

async function upsertOrgUnit(name: string) {
  const existing = await prisma.orgUnit.findFirst({
    where: { organizationId: ORG_ID, name },
  });
  if (existing) return existing;
  return prisma.orgUnit.create({
    data: { organizationId: ORG_ID, name, active: true },
  });
}

async function upsertCourse(name: string, mode: "EAD" | "HYBRID" | "IN_PERSON") {
  const existing = await prisma.product.findFirst({
    where: { organizationId: ORG_ID, name },
  });
  if (existing) return existing;
  const product = await prisma.product.create({
    data: {
      organizationId: ORG_ID,
      name,
      description: `Curso ${name}`,
      price: 200,
      unit: "matrícula",
      type: "SERVICE",
      kind: "COURSE",
      isActive: true,
    },
  });
  await prisma.courseConfig.create({
    data: {
      organizationId: ORG_ID,
      productId: product.id,
      mode,
    },
  });
  return product;
}

async function upsertCategory(input: {
  name: string;
  discountValue: number;
  exclusionGroup?: string;
}) {
  const existing = await prisma.discountCategory.findFirst({
    where: { organizationId: ORG_ID, name: input.name },
  });
  if (existing) return existing;
  return prisma.discountCategory.create({
    data: {
      organizationId: ORG_ID,
      name: input.name,
      discountType: "PERCENT",
      discountValue: input.discountValue,
      exclusionGroup: input.exclusionGroup ?? null,
      maxStacks: 1,
      calcMode: "CASCADE",
      active: true,
    },
  });
}

async function upsertAllocation(
  categoryId: string,
  categoryName: string,
  discountType: "PERCENT" | "FIXED",
  discountValue: number,
  orgUnitId: string,
  orgUnitName: string,
  qtyTotal: number | null,
) {
  const existing = await prisma.discountQuota.findFirst({
    where: {
      organizationId: ORG_ID,
      categoryId,
      orgUnitId,
    },
  });
  if (existing) {
    await prisma.discountQuota.update({
      where: { id: existing.id },
      data: { qtyTotal, active: true },
    });
    return existing;
  }
  return prisma.discountQuota.create({
    data: {
      organizationId: ORG_ID,
      name: `${categoryName} · ${orgUnitName}`,
      categoryId,
      discountType,
      discountValue,
      orgUnitId,
      qtyTotal,
      qtyConsumed: 0,
      active: true,
    },
  });
}

async function main() {
  console.log(`▶ Seeding cenário Cursos+Cotas em org=${ORG_ID}`);

  const org = await prisma.organization.findUnique({ where: { id: ORG_ID } });
  if (!org) {
    throw new Error(
      `Organization ${ORG_ID} não encontrada. Rode o seed principal primeiro.`,
    );
  }

  // 1) Unidades
  const barra = await upsertOrgUnit("Barra Funda");
  const sapopemba = await upsertOrgUnit("Sapopemba");
  console.log("  ✓ Unidades: Barra Funda, Sapopemba");

  // 2) Cursos
  const adm = await upsertCourse("Administração", "EAD");
  const ped = await upsertCourse("Pedagogia", "HYBRID");
  console.log(`  ✓ Cursos: ${adm.name}, ${ped.name}`);

  // 3) Categorias
  const categories = await Promise.all([
    upsertCategory({ name: "Balcão", discountValue: 25 }),
    upsertCategory({ name: "Estratégico", discountValue: 30 }),
    upsertCategory({ name: "Mar Aberto", discountValue: 10 }),
    upsertCategory({ name: "Transferência", discountValue: 20 }),
    upsertCategory({ name: "2ª Graduação", discountValue: 20 }),
    upsertCategory({ name: "Empresas Conveniadas", discountValue: 35 }),
  ]);
  const [balcao, estrategico, marAberto, transferencia, segunda, empresas] =
    categories;
  console.log(`  ✓ Categorias: ${categories.map((c) => c.name).join(", ")}`);

  // 4) Alocações por unidade (mock do enunciado)
  const alloc = async (
    cat: (typeof categories)[number],
    unit: { id: string; name: string },
    qty: number,
  ) => {
    await upsertAllocation(
      cat.id,
      cat.name,
      cat.discountType,
      Number(cat.discountValue),
      unit.id,
      unit.name,
      qty,
    );
  };

  // Barra Funda
  await alloc(balcao, barra, 50);
  await alloc(estrategico, barra, 10);
  await alloc(marAberto, barra, 20);
  await alloc(transferencia, barra, 20);
  await alloc(segunda, barra, 20);
  await alloc(empresas, barra, 20);

  // Sapopemba
  await alloc(balcao, sapopemba, 35);
  await alloc(estrategico, sapopemba, 7);
  await alloc(marAberto, sapopemba, 15);
  await alloc(transferencia, sapopemba, 15);
  await alloc(segunda, sapopemba, 15);
  await alloc(empresas, sapopemba, 15);

  console.log("  ✓ Alocações por (categoria × unidade)");
  console.log("✔ Seed do cenário concluído.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
