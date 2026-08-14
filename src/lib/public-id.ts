import type { Prisma } from "@prisma/client";

/** ID público na URL: só dígitos. CUID nunca casa. */
export function isNumericPublicId(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Models com `@@unique([organizationId, number])`.
 * Stage fica de fora (número é por funil, não por org).
 * User fica de fora (não passa pela extension de org-scope).
 */
export const NUMBERED_ORG_MODELS = new Set<Prisma.ModelName>([
  "Contact",
  "Company",
  "Pipeline",
  "Deal",
  "Conversation",
  "Tabulation",
  "Campaign",
  "Automation",
  "Tag",
  "Channel",
  "Department",
  "SavedFilter",
  "Product",
  "Catalog",
  "OrgUnit",
  "DistributionRule",
  "MessageTemplate",
  "QuickReply",
  "JobOpening",
  "Segment",
  "WhatsappFlowDefinition",
  "CustomField",
]);

export function idOrNumberWhere(orgId: string, idOrNumber: string) {
  if (isNumericPublicId(idOrNumber)) {
    return {
      organizationId_number: {
        organizationId: orgId,
        number: parseInt(idOrNumber, 10),
      },
    };
  }
  return { id: idOrNumber };
}

/** Se `where.id` for numérico, troca por `organizationId_number`. */
export function rewriteNumericIdWhere(
  where: Record<string, unknown> | undefined,
  orgId: string,
): Record<string, unknown> | undefined {
  if (!where || typeof where.id !== "string") return where;
  if (!isNumericPublicId(where.id)) return where;
  if (where.organizationId_number) return where;
  const { id, ...rest } = where;
  return {
    ...rest,
    organizationId_number: {
      organizationId: orgId,
      number: parseInt(id, 10),
    },
  };
}

type NumberAgg = {
  user: {
    aggregate: (args: {
      where: { organizationId: string };
      _max: { number: true };
    }) => Promise<{ _max: { number: number | null } }>;
  };
};

/** Próximo `User.number` da org. User não passa pela extension de scope. */
export async function nextUserNumber(
  organizationId: string,
  db: NumberAgg,
): Promise<number> {
  const r = await db.user.aggregate({
    where: { organizationId },
    _max: { number: true },
  });
  return (r._max.number ?? 0) + 1;
}
