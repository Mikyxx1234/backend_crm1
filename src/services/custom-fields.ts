import type { CustomFieldType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

export async function getCustomFields(entity = "contact") {
  return prisma.customField.findMany({
    where: { entity },
    orderBy: { name: "asc" },
  });
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
}) {
  return prisma.customField.create({
    data: withOrgFromCtx({
      name: data.name,
      label: data.label,
      type: data.type,
      options: data.options ?? [],
      required: data.required ?? false,
      entity: data.entity ?? "contact",
      showInInboxLeadPanel: data.showInInboxLeadPanel ?? false,
      inboxLeadPanelOrder: data.inboxLeadPanelOrder ?? null,
    }),
  });
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
  }
) {
  return prisma.customField.update({ where: { id }, data });
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

  return fields.map((f) => ({
    fieldId: f.id,
    name: f.name,
    label: f.label,
    type: f.type,
    options: f.options,
    required: f.required,
    value: f.values[0]?.value ?? null,
  }));
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

  return fields.map((f) => ({
    fieldId: f.id,
    name: f.name,
    label: f.label,
    type: f.type,
    options: f.options,
    required: f.required,
    value: f.dealValues[0]?.value ?? null,
  }));
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
