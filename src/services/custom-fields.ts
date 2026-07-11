import type { CustomFieldType, Prisma } from "@prisma/client";

import { parseHighlightRules, resolveHighlight } from "@/lib/highlight";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { getRequestContext } from "@/lib/request-context";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

export async function getCustomFields(entity = "contact"): Promise<
  (Awaited<ReturnType<typeof prisma.customField.findMany>> extends (infer T)[] ? T : never)[]
> {
  // Resolve organizationId a partir do contexto da request para filtrar explicitamente,
  // evitando dependência da extensão de org-scope do prisma scoped.
  const ctx = getRequestContext();
  const orgId = ctx?.organizationId ?? null;

  try {
    // Usa prismaBase com filtro explícito quando temos orgId (mais robusto).
    // Fallback para o cliente scoped nos raros casos sem orgId (ex: scripts).
    if (orgId) {
      return await prismaBase.customField.findMany({
        where: { entity, organizationId: orgId },
        orderBy: { name: "asc" },
      });
    }
    return await prisma.customField.findMany({
      where: { entity },
      orderBy: { name: "asc" },
    });
  } catch {
    // Fallback para quando a coluna showInDealPanel ainda não existe na DB
    // (migração pendente). Retorna os campos sem ela usando SQL raw.
    if (orgId) {
      const rows = await prismaBase.$queryRaw<Record<string, unknown>[]>`
        SELECT id, name, label, "type", options, required, entity,
               "showInInboxLeadPanel", "inboxLeadPanelOrder",
               "highlightRules", "organizationId"
        FROM custom_fields
        WHERE entity = ${entity} AND "organizationId" = ${orgId}
        ORDER BY name ASC
      `;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows.map((r) => ({ ...r, showInDealPanel: false })) as any;
    }
    const rows = await prismaBase.$queryRaw<Record<string, unknown>[]>`
      SELECT id, name, label, "type", options, required, entity,
             "showInInboxLeadPanel", "inboxLeadPanelOrder",
             "highlightRules", "organizationId"
      FROM custom_fields
      WHERE entity = ${entity}
      ORDER BY name ASC
    `;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((r) => ({ ...r, showInDealPanel: false })) as any;
  }
}

export async function getCustomFieldById(id: string) {
  return prisma.customField.findUnique({ where: { id } });
}

export async function createCustomField(data: {
  name: string;
  label: string;
  type: CustomFieldType;
  options?: string[];
  required?: boolean;
  entity?: string;
  showInInboxLeadPanel?: boolean;
  inboxLeadPanelOrder?: number | null;
  showInDealPanel?: boolean;
  highlightRules?: unknown;
}) {
  try {
    return await prisma.customField.create({
      data: withOrgFromCtx({
        name: data.name,
        label: data.label,
        type: data.type,
        options: data.options ?? [],
        required: data.required ?? false,
        entity: data.entity ?? "contact",
        showInInboxLeadPanel: data.showInInboxLeadPanel ?? false,
        inboxLeadPanelOrder: data.inboxLeadPanelOrder ?? null,
        showInDealPanel: data.showInDealPanel ?? false,
        ...(data.highlightRules !== undefined
          ? { highlightRules: parseHighlightRules(data.highlightRules) as unknown as Prisma.InputJsonValue }
          : {}),
      }),
    });
  } catch {
    // Fallback: cria sem showInDealPanel se a coluna ainda não existir
    return await prisma.customField.create({
      data: withOrgFromCtx({
        name: data.name,
        label: data.label,
        type: data.type,
        options: data.options ?? [],
        required: data.required ?? false,
        entity: data.entity ?? "contact",
        showInInboxLeadPanel: data.showInInboxLeadPanel ?? false,
        inboxLeadPanelOrder: data.inboxLeadPanelOrder ?? null,
        ...(data.highlightRules !== undefined
          ? { highlightRules: parseHighlightRules(data.highlightRules) as unknown as Prisma.InputJsonValue }
          : {}),
      }),
    });
  }
}

export async function updateCustomField(
  id: string,
  data: {
    label?: string;
    type?: CustomFieldType;
    options?: string[];
    required?: boolean;
    showInInboxLeadPanel?: boolean;
    inboxLeadPanelOrder?: number | null;
    showInDealPanel?: boolean;
    highlightRules?: unknown;
  }
) {
  const { highlightRules, showInDealPanel, ...rest } = data;
  const baseData = {
    ...rest,
    ...(highlightRules !== undefined
      ? { highlightRules: parseHighlightRules(highlightRules) as unknown as Prisma.InputJsonValue }
      : {}),
  };
  try {
    return await prisma.customField.update({
      where: { id },
      data: {
        ...baseData,
        ...(showInDealPanel !== undefined ? { showInDealPanel } : {}),
      },
    });
  } catch {
    // Fallback: atualiza sem showInDealPanel se a coluna ainda não existir
    return await prisma.customField.update({
      where: { id },
      data: baseData,
    });
  }
}

export async function deleteCustomField(id: string) {
  return prisma.customField.delete({ where: { id } });
}

export async function getContactCustomFieldValues(contactId: string) {
  const fields = await prisma.customField.findMany({
    where: { entity: "contact" },
    orderBy: { name: "asc" },
    include: {
      values: { where: { contactId } },
    },
  });

  return fields.map((f) => {
    const value = f.values[0]?.value ?? null;
    return {
      fieldId: f.id,
      name: f.name,
      label: f.label,
      type: f.type,
      options: f.options,
      required: f.required,
      value,
      highlight: resolveHighlight(value, f.highlightRules),
    };
  });
}

export async function upsertContactCustomFieldValues(
  contactId: string,
  values: { fieldId: string; value: string }[]
) {
  const ops = values.map((v) =>
    prisma.contactCustomFieldValue.upsert({
      where: {
        contactId_customFieldId: {
          contactId,
          customFieldId: v.fieldId,
        },
      },
      update: { value: v.value },
      create: withOrgFromCtx({
        contactId,
        customFieldId: v.fieldId,
        value: v.value,
      }),
    })
  );

  return prisma.$transaction(ops);
}

export async function getDealCustomFieldValues(dealId: string) {
  const fields = await prisma.customField.findMany({
    where: { entity: "deal" },
    orderBy: { name: "asc" },
    include: {
      dealValues: { where: { dealId } },
    },
  });

  return fields.map((f) => {
    const value = f.dealValues[0]?.value ?? null;
    return {
      fieldId: f.id,
      name: f.name,
      label: f.label,
      type: f.type,
      options: f.options,
      required: f.required,
      value,
      highlight: resolveHighlight(value, f.highlightRules),
    };
  });
}

export async function upsertDealCustomFieldValues(
  dealId: string,
  values: { fieldId: string; value: string }[]
) {
  const ops = values.map((v) =>
    prisma.dealCustomFieldValue.upsert({
      where: {
        dealId_customFieldId: {
          dealId,
          customFieldId: v.fieldId,
        },
      },
      update: { value: v.value },
      create: withOrgFromCtx({
        dealId,
        customFieldId: v.fieldId,
        value: v.value,
      }),
    })
  );

  return prisma.$transaction(ops);
}
