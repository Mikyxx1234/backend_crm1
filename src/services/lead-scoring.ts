import type { LifecycleStage } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const DEFAULT_LEAD_SCORING_WEIGHTS = {
  hasEmail: 10,
  hasPhone: 10,
  hasCompany: 15,
  perDeal: 20,
  perActivity: 5,
  maxActivityBonus: 50,
  lifecycleBonus: {
    MQL: 20,
    SQL: 30,
    OPPORTUNITY: 40,
  } as const satisfies Partial<Record<LifecycleStage, number>>,
} as const;

export type LeadScoringRule = {
  id: string;
  label: string;
  weight: number;
  description: string;
};

export function getLeadScoringRules(): LeadScoringRule[] {
  const w = DEFAULT_LEAD_SCORING_WEIGHTS;
  return [
    {
      id: "has_email",
      label: "E-mail preenchido",
      weight: w.hasEmail,
      description: "Contato possui e-mail válido cadastrado.",
    },
    {
      id: "has_phone",
      label: "Telefone preenchido",
      weight: w.hasPhone,
      description: "Contato possui telefone cadastrado.",
    },
    {
      id: "has_company",
      label: "Empresa vinculada",
      weight: w.hasCompany,
      description: "Contato está associado a uma empresa.",
    },
    {
      id: "per_deal",
      label: "Por negócio",
      weight: w.perDeal,
      description: "Pontos adicionados para cada negócio do contato.",
    },
    {
      id: "per_activity",
      label: "Por atividade",
      weight: w.perActivity,
      description: `Até ${w.maxActivityBonus} pontos somando atividades (5 cada).`,
    },
    {
      id: "lifecycle_mql",
      label: "Estágio MQL",
      weight: w.lifecycleBonus.MQL,
      description: "Bônus quando o estágio do ciclo de vida é MQL.",
    },
    {
      id: "lifecycle_sql",
      label: "Estágio SQL",
      weight: w.lifecycleBonus.SQL,
      description: "Bônus quando o estágio do ciclo de vida é SQL.",
    },
    {
      id: "lifecycle_opportunity",
      label: "Estágio Oportunidade",
      weight: w.lifecycleBonus.OPPORTUNITY,
      description: "Bônus quando o estágio do ciclo de vida é OPPORTUNITY.",
    },
  ];
}

export async function calculateLeadScore(contactId: string): Promise<number> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      _count: { select: { deals: true, activities: true } },
    },
  });

  if (!contact) {
    return 0;
  }

  const w = DEFAULT_LEAD_SCORING_WEIGHTS;
  let score = 0;

  if (contact.email && contact.email.trim().length > 0) {
    score += w.hasEmail;
  }
  if (contact.phone && contact.phone.trim().length > 0) {
    score += w.hasPhone;
  }
  if (contact.companyId) {
    score += w.hasCompany;
  }

  score += contact._count.deals * w.perDeal;

  const activityPoints = Math.min(
    w.maxActivityBonus,
    contact._count.activities * w.perActivity
  );
  score += activityPoints;

  const lifecycleBonus = w.lifecycleBonus[contact.lifecycleStage as keyof typeof w.lifecycleBonus];
  if (typeof lifecycleBonus === "number") {
    score += lifecycleBonus;
  }

  return score;
}

export async function updateContactScore(contactId: string): Promise<{ id: string; leadScore: number }> {
  const score = await calculateLeadScore(contactId);
  return prisma.contact.update({
    where: { id: contactId },
    data: { leadScore: score },
    select: { id: true, leadScore: true },
  });
}
