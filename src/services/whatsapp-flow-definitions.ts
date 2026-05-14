import { prisma } from "@/lib/prisma";
import { buildWaFlowJsonString, type CrmFlowScreenInput } from "@/lib/meta-whatsapp/build-static-wa-flow-json";
import type { MetaWhatsAppClient } from "@/lib/meta-whatsapp/client";

export type FlowDefinitionInputScreen = {
  title: string;
  sortOrder?: number;
  fields: {
    fieldKey: string;
    label: string;
    fieldType?: string;
    required?: boolean;
    sortOrder?: number;
    mapping?: {
      targetKind: "CONTACT_NATIVE" | "CUSTOM_FIELD";
      nativeKey?: string | null;
      customFieldId?: string | null;
    } | null;
  }[];
};

export type FlowDefinitionUpsertInput = {
  name: string;
  flowCategory?: string;
  screens: FlowDefinitionInputScreen[];
};

export async function listFlowDefinitions() {
  return prisma.whatsappFlowDefinition.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      metaFlowId: true,
      flowCategory: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
}

export async function getFlowDefinitionById(id: string) {
  return prisma.whatsappFlowDefinition.findFirst({
    where: { id },
    include: {
      screens: {
        orderBy: { sortOrder: "asc" },
        include: {
          fields: {
            orderBy: { sortOrder: "asc" },
            include: { mapping: true },
          },
        },
      },
    },
  });
}

export async function createFlowDefinitionDraft(
  orgId: string,
  input: FlowDefinitionUpsertInput,
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw new Error("Nome do flow é obrigatório.");
  const screensIn = input.screens?.length
    ? input.screens
    : [{ title: "Tela 1", fields: [] as FlowDefinitionInputScreen["fields"] }];

  const created = await prisma.$transaction(async (tx) => {
    const flow = await tx.whatsappFlowDefinition.create({
      data: {
        organizationId: orgId,
        name,
        status: "DRAFT",
        flowCategory: (input.flowCategory ?? "LEAD_GENERATION").trim() || "LEAD_GENERATION",
      },
    });

    let order = 0;
    for (const sc of screensIn) {
      const screen = await tx.whatsappFlowScreen.create({
        data: {
          flowId: flow.id,
          sortOrder: sc.sortOrder ?? order,
          title: sc.title.trim() || `Tela ${order + 1}`,
        },
      });
      let fOrder = 0;
      for (const f of sc.fields ?? []) {
        const field = await tx.whatsappFlowField.create({
          data: {
            screenId: screen.id,
            fieldKey: f.fieldKey.trim(),
            label: f.label.trim(),
            fieldType: (f.fieldType ?? "TEXT").trim(),
            required: Boolean(f.required),
            sortOrder: f.sortOrder ?? fOrder,
          },
        });
        const m = f.mapping;
        if (m && (m.targetKind === "CONTACT_NATIVE" || m.targetKind === "CUSTOM_FIELD")) {
          await tx.whatsappFlowFieldMapping.create({
            data: {
              fieldId: field.id,
              targetKind: m.targetKind,
              nativeKey: m.nativeKey?.trim() || null,
              customFieldId: m.customFieldId?.trim() || null,
            },
          });
        }
        fOrder += 1;
      }
      order += 1;
    }

    return flow;
  });

  return { id: created.id };
}

export async function replaceFlowDefinitionDraft(
  id: string,
  input: FlowDefinitionUpsertInput,
): Promise<void> {
  const existing = await prisma.whatsappFlowDefinition.findFirst({ where: { id } });
  if (!existing) throw new Error("Flow não encontrado.");
  if (existing.status !== "DRAFT") {
    throw new Error("Só é possível editar flows em rascunho.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.whatsappFlowScreen.deleteMany({ where: { flowId: id } });
    await tx.whatsappFlowDefinition.update({
      where: { id },
      data: {
        name: input.name.trim(),
        flowCategory: (input.flowCategory ?? existing.flowCategory).trim() || "LEAD_GENERATION",
      },
    });

    const screensIn = input.screens?.length
      ? input.screens
      : [{ title: "Tela 1", fields: [] as FlowDefinitionInputScreen["fields"] }];
    let order = 0;
    for (const sc of screensIn) {
      const screen = await tx.whatsappFlowScreen.create({
        data: {
          flowId: id,
          sortOrder: sc.sortOrder ?? order,
          title: sc.title.trim() || `Tela ${order + 1}`,
        },
      });
      let fOrder = 0;
      for (const f of sc.fields ?? []) {
        const field = await tx.whatsappFlowField.create({
          data: {
            screenId: screen.id,
            fieldKey: f.fieldKey.trim(),
            label: f.label.trim(),
            fieldType: (f.fieldType ?? "TEXT").trim(),
            required: Boolean(f.required),
            sortOrder: f.sortOrder ?? fOrder,
          },
        });
        const m = f.mapping;
        if (m && (m.targetKind === "CONTACT_NATIVE" || m.targetKind === "CUSTOM_FIELD")) {
          await tx.whatsappFlowFieldMapping.create({
            data: {
              fieldId: field.id,
              targetKind: m.targetKind,
              nativeKey: m.nativeKey?.trim() || null,
              customFieldId: m.customFieldId?.trim() || null,
            },
          });
        }
        fOrder += 1;
      }
      order += 1;
    }
  });
}

export async function deleteFlowDefinitionDraft(id: string, metaClient: MetaWhatsAppClient): Promise<void> {
  const existing = await prisma.whatsappFlowDefinition.findFirst({ where: { id } });
  if (!existing) throw new Error("Flow não encontrado.");
  if (existing.status !== "DRAFT") {
    throw new Error("Só é possível apagar flows em rascunho na Meta.");
  }
  if (existing.metaFlowId?.trim()) {
    try {
      await metaClient.deleteFlow(existing.metaFlowId.trim());
    } catch {
      /* best-effort */
    }
  }
  await prisma.whatsappFlowDefinition.delete({ where: { id } });
}

export type MetaCreateFlowResponse = {
  id?: string;
  success?: boolean;
  validation_errors?: unknown[];
};

export async function publishFlowDefinition(
  id: string,
  metaClient: MetaWhatsAppClient,
): Promise<{ metaFlowId: string; validationErrors: unknown[] }> {
  const full = await getFlowDefinitionById(id);
  if (!full) throw new Error("Flow não encontrado.");
  if (full.status !== "DRAFT") {
    throw new Error("Flow já publicado ou arquivado.");
  }

  const screens: CrmFlowScreenInput[] = full.screens.map((s) => ({
    title: s.title,
    fields: s.fields.map((f) => ({
      fieldKey: f.fieldKey,
      label: f.label,
      fieldType: f.fieldType,
      required: f.required,
    })),
  }));

  const flowJson = buildWaFlowJsonString({ screens });
  const categories = [full.flowCategory.trim().toUpperCase() || "LEAD_GENERATION"];

  const raw = (await metaClient.createFlow({
    name: full.name.slice(0, 512),
    categories,
    flow_json: flowJson,
    publish: true,
  })) as MetaCreateFlowResponse;

  const validationErrors = Array.isArray(raw.validation_errors) ? raw.validation_errors : [];
  const metaFlowId = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null;

  if (!metaFlowId) {
    const err = new Error(
      validationErrors.length
        ? "A Meta rejeitou o Flow JSON. Veja validation_errors."
        : "Resposta da Meta sem id do Flow.",
    );
    (err as Error & { validationErrors?: unknown[] }).validationErrors = validationErrors;
    throw err;
  }

  await prisma.whatsappFlowDefinition.update({
    where: { id },
    data: {
      status: "PUBLISHED",
      metaFlowId,
      publishedAt: new Date(),
      metaJsonVersion: "5.0",
    },
  });

  return { metaFlowId, validationErrors };
}
