import type { CustomFieldType, Prisma } from "@prisma/client";

import { getLogger } from "@/lib/logger";
import {
  cleanFlowFieldLabel,
  normalizeFlowMatchKey,
  sanitizeFlowFieldKey,
} from "@/lib/meta-whatsapp/parse-flow-response";
import { sendWhatsAppText } from "@/lib/send-whatsapp";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import { ensureOpenDealForContact } from "@/services/auto-deals";
import { resolveFlowDefinitionForInbound } from "@/services/whatsapp-flow-definitions";

const log = getLogger("whatsapp-flow-apply");

const MAX_VALIDATION_RETRIES = 2;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Tentativas de revalidação por contato+campo (processo Node; reinicia no deploy). */
const retryAttempts = new Map<string, number>();

export type FlowFieldApplyEntry = {
  fieldKey: string;
  label: string;
  target: string;
  value: string;
  responded: boolean;
};

export type FlowFieldSkipEntry = {
  fieldKey: string;
  reason: string;
};

export type FlowFieldInvalidEntry = {
  fieldKey: string;
  label: string;
  error: string;
  retrySent: boolean;
  attempt: number;
};

export type FlowApplyResult = {
  flowDefinitionId: string | null;
  applied: FlowFieldApplyEntry[];
  skipped: FlowFieldSkipEntry[];
  invalid: FlowFieldInvalidEntry[];
  alerts: string[];
  allRequiredResponded: boolean;
};

type FlowFieldWithMapping = {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  required: boolean;
  mapping: {
    targetKind: "CONTACT_NATIVE" | "DEAL_NATIVE" | "CUSTOM_FIELD";
    nativeKey: string | null;
    customFieldId: string | null;
    customField: { id: string; name: string; type: CustomFieldType; entity: string } | null;
  } | null;
};

function retryKey(contactId: string, fieldKey: string): string {
  return `${contactId}:${fieldKey}`;
}

function normalizeStringValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map((x) => normalizeStringValue(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.startsWith("55")) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

export function validateFlowFieldValue(
  fieldType: string,
  rawValue: string,
): { ok: true; normalized: string } | { ok: false; error: string } {
  const value = rawValue.trim();
  if (!value) {
    return { ok: false, error: "Resposta vazia." };
  }

  const t = fieldType.toUpperCase();
  if (t === "EMAIL") {
    const email = value.toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return { ok: false, error: "Informe um e-mail válido (ex.: nome@empresa.com)." };
    }
    return { ok: true, normalized: email };
  }

  if (t === "PHONE") {
    const phone = normalizePhone(value);
    if (!phone) {
      return {
        ok: false,
        error: "Informe um telefone válido com DDD (ex.: +5511999998888 ou 11999998888).",
      };
    }
    return { ok: true, normalized: phone };
  }

  return { ok: true, normalized: value };
}

async function getExistingNativeValue(
  contactId: string,
  nativeKey: string,
): Promise<string | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { name: true, email: true, phone: true, source: true },
  });
  if (!contact) return null;
  switch (nativeKey) {
    case "name":
      return contact.name ?? null;
    case "email":
      return contact.email ?? null;
    case "phone":
      return contact.phone ?? null;
    case "source":
      return contact.source ?? null;
    default:
      return null;
  }
}

async function getExistingContactCustomValue(
  contactId: string,
  customFieldId: string,
): Promise<string | null> {
  const row = await prisma.contactCustomFieldValue.findUnique({
    where: {
      contactId_customFieldId: { contactId, customFieldId },
    },
    select: { value: true },
  });
  return row?.value?.trim() ? row.value.trim() : null;
}

async function getExistingDealCustomValue(
  dealId: string,
  customFieldId: string,
): Promise<string | null> {
  const row = await prisma.dealCustomFieldValue.findUnique({
    where: {
      dealId_customFieldId: { dealId, customFieldId },
    },
    select: { value: true },
  });
  return row?.value?.trim() ? row.value.trim() : null;
}

async function resolveOpenDealId(contactId: string): Promise<string | null> {
  const deal = await prisma.deal.findFirst({
    where: { contactId, status: "OPEN" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return deal?.id ?? null;
}

async function ensureDealForContact(contactId: string): Promise<string | null> {
  const existing = await resolveOpenDealId(contactId);
  if (existing) return existing;

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { name: true },
  });
  const ensured = await ensureOpenDealForContact({
    contactId,
    contactName: contact?.name?.trim() || "Lead",
    logTag: "whatsapp-flow",
  });
  if (ensured.status === "skipped") return null;
  return ensured.dealId;
}

async function getExistingDealNativeValue(
  dealId: string,
  nativeKey: string,
): Promise<string | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { title: true, value: true, expectedClose: true },
  });
  if (!deal) return null;
  switch (nativeKey) {
    case "title":
      return deal.title?.trim() || null;
    case "value":
      return deal.value != null ? String(deal.value) : null;
    case "expectedClose":
      return deal.expectedClose ? deal.expectedClose.toISOString().slice(0, 10) : null;
    default:
      return null;
  }
}

async function applyDealNativeField(
  dealId: string,
  nativeKey: string,
  value: string,
): Promise<void> {
  const data: Prisma.DealUncheckedUpdateInput = {};
  if (nativeKey === "title") {
    data.title = value.slice(0, 512);
  } else if (nativeKey === "value") {
    const normalized = value.replace(/\s/g, "").replace(",", ".");
    const num = Number(normalized);
    if (!Number.isFinite(num) || num < 0) {
      throw new Error("Informe um valor numérico válido para o negócio.");
    }
    data.value = num;
  } else if (nativeKey === "expectedClose") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Informe uma data válida (ex.: 2026-12-31).");
    }
    data.expectedClose = parsed;
  } else {
    throw new Error(`Campo nativo de negócio não suportado: ${nativeKey}`);
  }
  await prisma.deal.update({ where: { id: dealId }, data });
}

async function applyNativeField(
  contactId: string,
  nativeKey: string,
  value: string,
): Promise<void> {
  const data: Prisma.ContactUncheckedUpdateInput = {};
  if (nativeKey === "name") data.name = value;
  else if (nativeKey === "email") data.email = value;
  else if (nativeKey === "phone") data.phone = value;
  else if (nativeKey === "source") data.source = value;
  else {
    throw new Error(`Campo nativo não suportado: ${nativeKey}`);
  }
  await prisma.contact.update({ where: { id: contactId }, data });
}

async function sendValidationRetryMessage(opts: {
  conversationId: string;
  contactId: string;
  channelRef: { id: string; provider: string } | null;
  waJid: string | null;
  label: string;
  error: string;
  attempt: number;
}): Promise<boolean> {
  const content =
    `⚠️ Não consegui salvar *${opts.label}*.\n` +
    `${opts.error}\n\n` +
    `Por favor, responda novamente com o formato correto ` +
    `(tentativa ${opts.attempt}/${MAX_VALIDATION_RETRIES}).`;

  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: opts.conversationId },
      select: { id: true, contactId: true, waJid: true },
    });
    if (!conv) return false;

    const saved = await prisma.message.create({
      data: withOrgFromCtx({
        conversationId: opts.conversationId,
        content,
        direction: "out",
        messageType: "text",
        senderName: "Assistente CRM",
        authorType: "bot",
      }),
    });

    const result = await sendWhatsAppText({
      conversationId: opts.conversationId,
      contactId: opts.contactId,
      channelRef: opts.channelRef,
      content,
      messageId: saved.id,
      waJid: opts.waJid ?? conv.waJid,
    });

    if (result.failed) {
      log.warn("[whatsapp-flow] falha ao enviar retry de validação", {
        contactId: opts.contactId,
        error: result.error,
      });
      return false;
    }
    return true;
  } catch (err) {
    log.warn("[whatsapp-flow] erro ao enviar retry de validação", {
      contactId: opts.contactId,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function findFieldDefinition(
  fields: FlowFieldWithMapping[],
  responseKey: string,
): FlowFieldWithMapping | undefined {
  const sanitized = sanitizeFlowFieldKey(responseKey);

  // (1) Match exato pelo fieldKey (flows criados pelo builder do CRM, em
  // que a chave do payload == fieldKey).
  const exact = fields.find(
    (f) =>
      f.fieldKey === responseKey ||
      sanitizeFlowFieldKey(f.fieldKey) === sanitized ||
      f.fieldKey === sanitized,
  );
  if (exact) return exact;

  // (2) Match tolerante pelo RÓTULO normalizado. Flows criados/importados
  // pela Meta entregam a resposta com a chave derivada do label
  // (ex.: `screen_0_Nome_Completo_0` / `Numero_de_Telefone`), enquanto o
  // `fieldKey` salvo carrega um sufixo hash (`Nome_Completo_608eea`). Sem
  // isto, nenhum campo casava e nada era gravado.
  const respNorm = normalizeFlowMatchKey(cleanFlowFieldLabel(responseKey));
  if (!respNorm) return undefined;
  return fields.find((f) => {
    const labelNorm = normalizeFlowMatchKey(f.label);
    const keyNorm = normalizeFlowMatchKey(f.fieldKey);
    return (
      labelNorm === respNorm ||
      keyNorm === respNorm ||
      // fieldKey costuma ser "<label><hash>"; aceita prefixo.
      (respNorm.length >= 3 && keyNorm.startsWith(respNorm))
    );
  });
}

/**
 * Aplica respostas de WhatsApp Flow nos campos mapeados (negócio e/ou contato legado).
 */
export async function applyWhatsappFlowResponseToContact(params: {
  contactId: string;
  conversationId: string;
  organizationId: string;
  flowPayload: Record<string, unknown>;
  flowMetaName?: string | null;
  flowToken?: string | null;
  channelRef?: { id: string; provider: string } | null;
  waJid?: string | null;
}): Promise<FlowApplyResult> {
  const result: FlowApplyResult = {
    flowDefinitionId: null,
    applied: [],
    skipped: [],
    invalid: [],
    alerts: [],
    allRequiredResponded: false,
  };

  const flowDef = await resolveFlowDefinitionForInbound({
    organizationId: params.organizationId,
    conversationId: params.conversationId,
    flowMetaName: params.flowMetaName,
    flowToken: params.flowToken,
    responseKeys: Object.keys(params.flowPayload),
  });

  if (!flowDef) {
    result.alerts.push(
      "Nenhum flow publicado encontrado para correlacionar a resposta. Configure mappings no CRM.",
    );
    log.warn("[whatsapp-flow] apply: flow não resolvido", {
      contactId: params.contactId,
      flowMetaName: params.flowMetaName,
      flowToken: params.flowToken,
      keys: Object.keys(params.flowPayload),
    });
    return result;
  }

  result.flowDefinitionId = flowDef.id;

  const allFields: FlowFieldWithMapping[] = flowDef.screens.flatMap((s) => s.fields);

  const needsDeal =
    allFields.some(
      (f) =>
        f.mapping?.targetKind === "DEAL_NATIVE" ||
        (f.mapping?.targetKind === "CUSTOM_FIELD" && f.mapping.customField?.entity === "deal"),
    ) ?? false;

  let dealId: string | null = null;
  if (needsDeal) {
    dealId = await ensureDealForContact(params.contactId);
    if (!dealId) {
      result.alerts.push(
        "Nenhum negócio aberto para gravar os campos mapeados. Crie um negócio no pipeline ou verifique o pipeline padrão.",
      );
    }
  }

  for (const [responseKey, raw] of Object.entries(params.flowPayload)) {
    const rawValue = normalizeStringValue(raw);
    const fieldDef = findFieldDefinition(allFields, responseKey);

    if (!fieldDef) {
      result.skipped.push({
        fieldKey: responseKey,
        reason: "Campo não configurado no flow do CRM.",
      });
      continue;
    }

    const mapping = fieldDef.mapping;
    if (!mapping) {
      result.alerts.push(
        `Campo "${fieldDef.label}" (${fieldDef.fieldKey}) sem mapping — configure no editor de flows.`,
      );
      log.warn("[whatsapp-flow] campo sem mapping", {
        contactId: params.contactId,
        fieldKey: fieldDef.fieldKey,
        flowDefinitionId: flowDef.id,
      });
      continue;
    }

    if (!rawValue) {
      result.skipped.push({
        fieldKey: fieldDef.fieldKey,
        reason: "Resposta vazia — campo existente preservado.",
      });
      continue;
    }

    const validation = validateFlowFieldValue(fieldDef.fieldType, rawValue);
    if (!validation.ok) {
      const rKey = retryKey(params.contactId, fieldDef.fieldKey);
      const prev = retryAttempts.get(rKey) ?? 0;
      const attempt = prev + 1;
      retryAttempts.set(rKey, attempt);

      let retrySent = false;
      if (attempt <= MAX_VALIDATION_RETRIES) {
        retrySent = await sendValidationRetryMessage({
          conversationId: params.conversationId,
          contactId: params.contactId,
          channelRef: params.channelRef ?? null,
          waJid: params.waJid ?? null,
          label: fieldDef.label,
          error: validation.error,
          attempt,
        });
      }

      result.invalid.push({
        fieldKey: fieldDef.fieldKey,
        label: fieldDef.label,
        error: validation.error,
        retrySent,
        attempt,
      });

      log.info("[whatsapp-flow] validação falhou", {
        contactId: params.contactId,
        fieldKey: fieldDef.fieldKey,
        error: validation.error,
        attempt,
        retrySent,
      });
      continue;
    }

    retryAttempts.delete(retryKey(params.contactId, fieldDef.fieldKey));

    try {
      if (mapping.targetKind === "CONTACT_NATIVE") {
        const nativeKey = mapping.nativeKey?.trim();
        if (!nativeKey) {
          result.alerts.push(`Mapping nativo incompleto para "${fieldDef.fieldKey}".`);
          continue;
        }

        const existing = await getExistingNativeValue(params.contactId, nativeKey);
        if (existing && !validation.normalized) {
          result.skipped.push({
            fieldKey: fieldDef.fieldKey,
            reason: "Valor vazio não sobrescreve campo existente.",
          });
          continue;
        }

        await applyNativeField(params.contactId, nativeKey, validation.normalized);

        result.applied.push({
          fieldKey: fieldDef.fieldKey,
          label: fieldDef.label,
          target: `contact.${nativeKey}`,
          value: validation.normalized,
          responded: true,
        });
      } else if (mapping.targetKind === "DEAL_NATIVE") {
        const nativeKey = mapping.nativeKey?.trim();
        if (!nativeKey) {
          result.alerts.push(`Mapping de negócio incompleto para "${fieldDef.fieldKey}".`);
          continue;
        }
        if (!dealId) {
          result.skipped.push({
            fieldKey: fieldDef.fieldKey,
            reason: "Sem negócio aberto para gravar.",
          });
          continue;
        }

        const existing = await getExistingDealNativeValue(dealId, nativeKey);
        if (existing && !validation.normalized) {
          result.skipped.push({
            fieldKey: fieldDef.fieldKey,
            reason: "Valor vazio não sobrescreve campo existente.",
          });
          continue;
        }

        await applyDealNativeField(dealId, nativeKey, validation.normalized);

        result.applied.push({
          fieldKey: fieldDef.fieldKey,
          label: fieldDef.label,
          target: `deal.${nativeKey}`,
          value: validation.normalized,
          responded: true,
        });
      } else if (mapping.targetKind === "CUSTOM_FIELD") {
        const cf = mapping.customField;
        if (!cf) {
          result.alerts.push(
            `Campo customizado não encontrado para "${fieldDef.fieldKey}" — revisar mapping.`,
          );
          log.error("[whatsapp-flow] custom field ausente no mapping", {
            contactId: params.contactId,
            fieldKey: fieldDef.fieldKey,
            customFieldId: mapping.customFieldId,
          });
          continue;
        }

        if (cf.entity === "deal") {
          if (!dealId) {
            result.skipped.push({
              fieldKey: fieldDef.fieldKey,
              reason: "Sem negócio aberto para gravar.",
            });
            continue;
          }

          const existing = await getExistingDealCustomValue(dealId, cf.id);
          if (existing && !validation.normalized) {
            result.skipped.push({
              fieldKey: fieldDef.fieldKey,
              reason: "Valor vazio não sobrescreve campo existente.",
            });
            continue;
          }

          await prisma.dealCustomFieldValue.upsert({
            where: {
              dealId_customFieldId: { dealId, customFieldId: cf.id },
            },
            update: { value: validation.normalized },
            create: withOrgFromCtx({
              dealId,
              customFieldId: cf.id,
              value: validation.normalized,
            }),
          });

          result.applied.push({
            fieldKey: fieldDef.fieldKey,
            label: fieldDef.label,
            target: `deal.custom.${cf.name}`,
            value: validation.normalized,
            responded: true,
          });
        } else {
          const existing = await getExistingContactCustomValue(params.contactId, cf.id);
          if (existing && !validation.normalized) {
            result.skipped.push({
              fieldKey: fieldDef.fieldKey,
              reason: "Valor vazio não sobrescreve campo existente.",
            });
            continue;
          }

          await prisma.contactCustomFieldValue.upsert({
            where: {
              contactId_customFieldId: {
                contactId: params.contactId,
                customFieldId: cf.id,
              },
            },
            update: { value: validation.normalized },
            create: withOrgFromCtx({
              contactId: params.contactId,
              customFieldId: cf.id,
              value: validation.normalized,
            }),
          });

          result.applied.push({
            fieldKey: fieldDef.fieldKey,
            label: fieldDef.label,
            target: `contact.custom.${cf.name}`,
            value: validation.normalized,
            responded: true,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.alerts.push(`Erro ao gravar "${fieldDef.label}": ${msg}`);
      log.error("[whatsapp-flow] falha ao gravar campo", {
        contactId: params.contactId,
        fieldKey: fieldDef.fieldKey,
        error: msg,
      });
    }
  }

  const requiredFields = allFields.filter((f) => f.required && f.mapping);
  const appliedKeys = new Set(result.applied.map((a) => a.fieldKey));
  result.allRequiredResponded = requiredFields.every((f) => appliedKeys.has(f.fieldKey));

  log.info("[whatsapp-flow] apply concluído", {
    contactId: params.contactId,
    flowDefinitionId: flowDef.id,
    applied: result.applied.length,
    skipped: result.skipped.length,
    invalid: result.invalid.length,
    alerts: result.alerts.length,
    allRequiredResponded: result.allRequiredResponded,
  });

  return result;
}
