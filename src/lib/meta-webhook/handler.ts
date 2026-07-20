import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { withSystemContext } from "@/lib/webhook-context";
import { phoneMatchVariants } from "@/lib/phone";
import { CRM_META_APP_SECRET } from "@/lib/meta-constants";
import { nextContactNumber } from "@/services/contacts";
import {
  isActiveConversationUniqueViolation,
  withConversationNumberRetry,
} from "@/services/conversations";
import { verifyMetaWebhookSignature } from "@/lib/meta-webhook-signature";
import { decryptSecret, isEncryptedSecret } from "@/lib/crypto/secrets";
import { generateFileName, saveFile } from "@/lib/storage/local";

/**
 * Scope multi-tenancy do webhook. Quando presente:
 *   - GET valida verifyToken contra Channel.config.verifyToken DESSA org
 *   - POST valida appSecret contra Channel.config.appSecret DESSA org
 *   - Toda a logica de processamento roda dentro de withSystemContext(orgId)
 *     -> Prisma extension filtra todas as queries por organizationId
 *     -> impossivel vazar cross-org
 *
 * Quando ausente (rota legacy /api/webhooks/meta sem slug):
 *   - GET valida META_WEBHOOK_VERIFY_TOKEN env (compartilhado)
 *   - POST valida appSecret contra TODOS os canais Meta (any-match)
 *   - Sem context (deprecated; ver doc/onboarding-meta-cliente.md)
 */
export type WebhookScope = {
  organizationId: string;
  organizationSlug: string;
};
import { sseBus } from "@/lib/sse-bus";
import { getOrgIdOrNull } from "@/lib/request-context";
import { withOrgFromCtx } from "@/lib/prisma-helpers";
import {
  maybeDenyWhatsappCallConsent,
  maybeGrantWhatsappCallConsent,
} from "@/services/whatsapp-call-consent-webhook";
import { fireTrigger } from "@/services/automation-triggers";
import { resolveAdAndPersistAsync } from "@/services/meta-ad-resolver";
import { maybeReplyAsAIAgent } from "@/services/ai/inbox-handler";
import { ensureOpenDealForContact } from "@/services/auto-deals";
import { sanitizeContactName } from "@/lib/display-name";
import { getLogger } from "@/lib/logger";

// Marcador único de build — usado pra confirmar via `grep` no bundle se o
// rebuild do Easypanel pegou esta versão do source. Não tem outra função.
const META_WEBHOOK_BUILD_MARKER = "BUILD_2026_05_14_T_20_36_FLOW_FIX_ACTIVE";
void META_WEBHOOK_BUILD_MARKER;

const log = getLogger("meta-webhook");
import { processMetaWhatsappCallsWebhook } from "@/services/meta-whatsapp-calls-webhook";
import { processIncomingMessage as processSalesbotMessage } from "@/services/automation-context";
import { logEvent, logMessageFailed } from "@/services/activity-log";
import { metaErrorReason } from "@/lib/meta-whatsapp/error-catalog";
import { notifyInboundMessage } from "@/lib/web-push";
import { cancelPendingForConversation } from "@/services/scheduled-messages";
import { markCampaignReplyByContact } from "@/services/campaigns";
import {
  formatWhatsappFlowResponse,
  parseWhatsappFlowResponsePayload,
} from "@/lib/meta-whatsapp/parse-flow-response";
import { applyWhatsappFlowResponseToContact } from "@/services/whatsapp-flow-response";

type ReferralInfo = {
  sourceId: string | null;
  sourceType: string | null;
  ctwaClid: string | null;
  headline: string | null;
  body: string | null;
  sourceUrl: string | null;
};

// Token de verificação do webhook Meta. Sem fallback hardcoded — se não
// estiver configurado em produção, o GET de verificação responde 503 e o
// admin é forçado a configurar o env (evita "esquecer" e ficar com token
// padrão público no GitHub).
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || "";

// Exige assinatura valida sempre que NAO estamos em dev local. Antes
// esta flag so exigia em `production`, o que deixava staging/preview
// aceitando webhooks sem assinatura — um atacante podia forjar payload
// "do Meta" e injetar mensagens/contatos/automations em qualquer
// ambiente pre-prod exposto na internet.
const REQUIRE_SIGNATURE =
  process.env.NODE_ENV !== "development" || !!process.env.CI_STAGING;

const recentlyProcessed = new Map<string, number>();
const DEDUP_TTL = 30_000;

function isDuplicate(waMessageId: string): boolean {
  const now = Date.now();
  if (recentlyProcessed.size > 500) {
    for (const [k, t] of recentlyProcessed) {
      if (now - t > DEDUP_TTL) recentlyProcessed.delete(k);
    }
  }
  if (recentlyProcessed.has(waMessageId)) return true;
  recentlyProcessed.set(waMessageId, now);
  return false;
}

// ── Helpers ──────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function parseReferral(message: Record<string, unknown>): ReferralInfo | null {
  const ref = obj(message.referral);
  if (Object.keys(ref).length === 0) return null;
  return {
    sourceId: str(ref.source_id) || null,
    sourceType: str(ref.source_type) || null,
    ctwaClid: str(ref.ctwa_clid) || null,
    headline: str(ref.headline) || null,
    body: str(ref.body) || null,
    sourceUrl: str(ref.source_url) || null,
  };
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("55") ? `+${digits}` : `+${digits}`;
}

// ── WhatsApp "system" events: troca de número do cliente ─────────
//
// A Meta dispara `messages[].type = "system"` com `system.type` igual
// a `user_changed_number` (ou `customer_identity_changed` em algumas
// versões) quando o cliente migra o WhatsApp pra um novo telefone
// preservando o **mesmo BSUID** (`user_id`). O `wa_id` no payload é
// o NOVO número; o `body` traz a mensagem humana com os dois números
// (ex.: "USER A CHANGED FROM 5511982063029 TO 5511951624721").
//
// Este helper extrai os dois números e o BSUID novo a partir do payload
// raw, retorna `null` se não for um evento de troca relevante.
//
// Ref: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/system
type SystemEventInfo = {
  kind: "user_changed_number";
  oldPhone: string | null;
  newPhone: string | null;
  newBsuid: string | null;
  rawBody: string;
};

function extractSystemEvent(rawMessage: Record<string, unknown>): SystemEventInfo | null {
  const sys = obj(rawMessage.system);
  const sysType = str(sys.type).toLowerCase();
  const body = str(sys.body);

  // Tipos conhecidos da Meta que indicam "mesmo cliente, novo número".
  // `customer_identity_changed` aparece em payloads mais novos; aceitamos
  // os dois pra resiliência (a Meta já trocou o nome desse evento uma vez).
  const isNumberChange =
    sysType === "user_changed_number" ||
    sysType === "customer_identity_changed" ||
    /\bchanged\s+from\b.+\bto\b/i.test(body);

  if (!isNumberChange) return null;

  // Tentativa 1: parsear "FROM <old> TO <new>" do body (formato canônico
  // que a Meta envia em inglês mesmo pra contas pt-BR).
  let oldPhone: string | null = null;
  let newPhone: string | null = null;

  const m = body.match(/from\s+(\+?\d[\d\s-]{6,})\s+to\s+(\+?\d[\d\s-]{6,})/i);
  if (m) {
    const oldDigits = m[1].replace(/\D/g, "");
    const newDigits = m[2].replace(/\D/g, "");
    if (oldDigits.length >= 8) oldPhone = normalizePhone(oldDigits);
    if (newDigits.length >= 8) newPhone = normalizePhone(newDigits);
  }

  // Tentativa 2: fallback para campos estruturados (alguns payloads da
  // Meta trazem os WAIDs em `system.wa_id` (novo) e `m.from` (antigo)).
  if (!newPhone) {
    const sysWa = str(sys.wa_id);
    if (sysWa.replace(/\D/g, "").length >= 8) newPhone = normalizePhone(sysWa);
  }
  if (!oldPhone) {
    const fromWa = str(rawMessage.from);
    if (fromWa && fromWa !== str(sys.wa_id) && fromWa.replace(/\D/g, "").length >= 8) {
      oldPhone = normalizePhone(fromWa);
    }
  }

  const newBsuid = str(sys.user_id) || null;

  return {
    kind: "user_changed_number",
    oldPhone,
    newPhone,
    newBsuid,
    rawBody: body,
  };
}

/**
 * Processa um evento de troca de número:
 *  1. Atualiza `contact.phone` (e `whatsappBsuid`, se faltava) — o
 *     contato preserva todo o histórico (mesma row, mesmas conversas,
 *     deals, notas, atividades).
 *  2. Grava um registro imutável em `contact_phone_changes` pra
 *     auditoria + relatório agregado.
 *  3. Publica `contact_updated` no SSE bus pra UI atualizar o painel
 *     lateral em tempo real.
 *
 * Idempotente: se já existe um log com o mesmo `messageExternalId`,
 * não faz nada (segurança contra reentrega do webhook).
 */
async function applyContactPhoneChange(params: {
  contactId: string;
  currentPhone: string | null;
  currentBsuid: string | null;
  currentName: string | null;
  event: SystemEventInfo;
  messageExternalId: string;
}): Promise<{ updatedPhone: string | null; logged: boolean }> {
  const { contactId, currentPhone, currentBsuid, currentName, event, messageExternalId } = params;

  const existingLog = await prisma.contactPhoneChange.findFirst({
    where: { messageExternalId },
    select: { id: true },
  });
  if (existingLog) return { updatedPhone: currentPhone, logged: false };

  // Se o body não trouxe `from` (raro), assume o telefone atual do
  // contato como antigo — assim ainda registramos a transição.
  const oldPhone = event.oldPhone ?? currentPhone;
  const newPhone = event.newPhone;

  const contactUpdates: { phone?: string; whatsappBsuid?: string; name?: string } = {};
  if (newPhone && newPhone !== currentPhone) {
    contactUpdates.phone = newPhone;
  }
  if (event.newBsuid && !currentBsuid) {
    contactUpdates.whatsappBsuid = event.newBsuid;
  }

  // Quando o nome ainda é o auto-gerado "Lead +<oldphone>" / "Lead <oldphone>"
  // (porque o cliente nunca teve perfil capturado), atualizamos pra
  // refletir o novo telefone — caso contrário a inbox fica mostrando o
  // número antigo no título do card mesmo após a troca, como se fosse
  // um lead diferente. Nomes definidos pelo operador (qualquer coisa que
  // não case com o pattern auto) são preservados.
  if (newPhone && currentName && oldPhone) {
    const oldDigitsOnly = oldPhone.replace(/\D/g, "");
    const autoNamePattern = new RegExp(
      `^Lead\\s*\\+?${oldDigitsOnly}\\s*$`,
      "i",
    );
    if (autoNamePattern.test(currentName)) {
      contactUpdates.name = `Lead ${newPhone}`;
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (Object.keys(contactUpdates).length > 0) {
        await tx.contact.update({
          where: { id: contactId },
          data: contactUpdates,
        });
      }
      await tx.contactPhoneChange.create({
        data: withOrgFromCtx({
          contactId,
          oldPhone,
          newPhone,
          oldBsuid: currentBsuid,
          newBsuid: event.newBsuid,
          source: "WHATSAPP_SYSTEM" as const,
          rawSystemBody: event.rawBody || null,
          messageExternalId,
        }),
      });
    });
  } catch (err) {
    // P2002 = violação de unicidade. Acontece quando duas réplicas
    // processam o mesmo wamid em paralelo. A segunda é a duplicada e
    // pode ser ignorada — o contato já foi atualizado e o log já existe.
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      log.debug(
        `applyContactPhoneChange: duplicata por race (${messageExternalId}) — ignorando`,
      );
      return { updatedPhone: contactUpdates.phone ?? currentPhone, logged: false };
    }
    throw err;
  }

  try {
    sseBus.publish("contact_updated", {
      organizationId: getOrgIdOrNull(),
      contactId,
      reason: "phone_changed",
      oldPhone,
      newPhone,
    });
  } catch {
    // SSE é best-effort — log do banco já está consistente.
  }

  log.info(`Contato ${contactId} trocou de número: ${oldPhone ?? "?"} → ${newPhone ?? "?"}`);

  return { updatedPhone: contactUpdates.phone ?? currentPhone, logged: true };
}

// ── Contact resolution ───────────────────────────

type CrmContact = {
  id: string;
  name: string;
  phone: string | null;
  whatsappBsuid: string | null;
  whatsappUsername: string | null;
};

type ContactRow = {
  id: string;
  name: string;
  phone: string | null;
  whatsappBsuid: string | null;
  whatsappUsername: string | null;
};

/**
 * Resolve contato a partir do webhook Meta, com BSUID (user_id / from_user_id) e/ou telefone (wa_id / from).
 * Ref: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
 */
async function isKnownPhoneNumberId(phoneNumberId: string): Promise<boolean> {
  const envPhoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (envPhoneId && phoneNumberId === envPhoneId) return true;

  const channels = await prisma.channel.findMany({
    where: { type: "WHATSAPP", provider: "META_CLOUD_API" },
    select: { config: true },
  });
  for (const ch of channels) {
    const cfg = ch.config as Record<string, unknown> | null;
    if (cfg && String(cfg.phoneNumberId ?? "").trim() === phoneNumberId) return true;
  }
  return false;
}

async function findChannelByPhoneNumberId(phoneNumberId?: string) {
  if (!phoneNumberId) return null;
  // Quando o handler roda dentro de withSystemContext(orgId), a Prisma
  // extension automaticamente injeta organizationId no where -> esta
  // findMany so devolve canais DESSA org. Sem context (rota legacy)
  // pode dar erro "fora de RequestContext" — esperado, eh sinal pro
  // admin migrar pra rota com slug.
  const channels = await prisma.channel.findMany({
    where: { type: "WHATSAPP", provider: "META_CLOUD_API" },
    select: { id: true, name: true, config: true },
  });
  for (const ch of channels) {
    const cfg = ch.config as Record<string, unknown> | null;
    if (cfg && String(cfg.phoneNumberId ?? "").trim() === phoneNumberId) return ch;
  }
  // ANTES retornava `channels[0] ?? null` — bug critico: se nenhum canal
  // batesse com o phone_number_id, escolhia o primeiro de qualquer org
  // (cross-tenant leak). Agora retorna null e o caller decide ignorar.
  return null;
}

async function getChannelSourceName(phoneNumberId?: string): Promise<string> {
  const channel = await findChannelByPhoneNumberId(phoneNumberId);
  if (!channel) return "WhatsApp";
  const cfg = channel.config as Record<string, unknown> | null;
  const appName = typeof cfg?.appName === "string" ? cfg.appName.trim() : "";
  return appName || channel.name || "WhatsApp";
}

// ── Reply & Reaction helpers ─────────────────────────────────────
//
// Estas duas funções sustentam o UX estilo WhatsApp de citação e
// reações no CRM. Elas rodam DENTRO de withSystemContext(orgId), então
// a Prisma extension já escopa por organização automaticamente.

type ReactionEntry = {
  emoji: string;
  from: string;      // wa_id / bsuid do reator
  at: string;        // ISO timestamp
};

/**
 * Aplica uma reação inbound ao Message alvo (identificado pelo wamid).
 * `emoji === null` remove a reação daquele contato. Idempotente: reagir
 * de novo com o mesmo emoji substitui o timestamp.
 */
async function applyIncomingReaction(params: {
  targetWaMessageId: string;
  emoji: string | null;
  fromWaId: string;
  at: Date;
}): Promise<void> {
  const { targetWaMessageId, emoji, fromWaId, at } = params;
  if (!targetWaMessageId || !fromWaId) return;

  const target = await prisma.message.findFirst({
    where: { externalId: targetWaMessageId },
    select: { id: true, reactions: true },
  });
  if (!target) {
    log.debug(
      `Reação recebida para wamid desconhecido (${targetWaMessageId}) — ignorando.`,
    );
    return;
  }

  const current: ReactionEntry[] = Array.isArray(target.reactions)
    ? (target.reactions as unknown as ReactionEntry[]).filter(
        (r) => r && typeof r === "object" && typeof r.emoji === "string" && typeof r.from === "string",
      )
    : [];

  // Cliente sempre tem no máximo 1 reação por mensagem (regra do WhatsApp).
  // Removemos qualquer entrada anterior desse `from` antes de adicionar.
  const withoutFrom = current.filter((r) => r.from !== fromWaId);
  const next = emoji
    ? [...withoutFrom, { emoji, from: fromWaId, at: at.toISOString() }]
    : withoutFrom;

  await prisma.message.update({
    where: { id: target.id },
    data: { reactions: next as unknown as object[] },
  });
}

/**
 * Resolve o alvo de uma citação. Retorna { messageId, preview } quando
 * a Meta mandou `context.id` e encontramos o Message correspondente no
 * CRM. `preview` é um snapshot curto (~120 chars) do conteúdo, servido
 * como fallback para desenhar a citação sem precisar de novo JOIN no
 * frontend.
 */
async function resolveReplyContext(
  waMessageId: string,
): Promise<{ messageId: string; preview: string } | null> {
  const target = await prisma.message.findFirst({
    where: { externalId: waMessageId },
    select: { id: true, content: true },
  });
  if (!target) return null;
  const preview = (target.content ?? "").trim().slice(0, 120);
  return { messageId: target.id, preview };
}

async function resolveWebhookContact(
  waIdRaw: string | undefined,
  bsuidRaw: string | undefined,
  profileName: string | null,
  phoneNumberId?: string,
  opts?: { username?: string | null },
): Promise<CrmContact>;
async function resolveWebhookContact(
  waIdRaw: string | undefined,
  bsuidRaw: string | undefined,
  profileName: string | null,
  phoneNumberId: string | undefined,
  opts: { createIfMissing: false; username?: string | null },
): Promise<CrmContact | null>;
async function resolveWebhookContact(
  waIdRaw: string | undefined,
  bsuidRaw: string | undefined,
  profileName: string | null,
  phoneNumberId?: string,
  opts: { createIfMissing?: boolean; username?: string | null } = {},
): Promise<CrmContact | null> {
  const createIfMissing = opts.createIfMissing !== false;
  const username = opts.username?.trim().replace(/^@/, "") || undefined;
  const bsuid = bsuidRaw?.trim() || undefined;
  let phone: string | null = null;
  if (waIdRaw) {
    const digits = waIdRaw.replace(/\D/g, "");
    if (digits.length >= 8) {
      phone = normalizePhone(waIdRaw);
    }
  }

  if (!phone && !bsuid) {
    throw new Error("resolveWebhookContact: sem identificador wa_id nem BSUID");
  }

  let byBs: ContactRow | null = null;
  if (bsuid) {
    byBs = await prisma.contact.findFirst({
      where: { whatsappBsuid: bsuid },
      select: { id: true, name: true, phone: true, whatsappBsuid: true, whatsappUsername: true },
    });
  }

  let byPh: ContactRow | null = null;
  if (phone) {
    // Match por variantes E.164 (cobre com/sem 9º dígito BR). Já é
    // org-scoped pela extensão do Prisma dentro de withSystemContext.
    const variants = phoneMatchVariants(phone);
    byPh = await prisma.contact.findFirst({
      where: variants.length > 0 ? { phone: { in: variants } } : { phone },
      select: { id: true, name: true, phone: true, whatsappBsuid: true, whatsappUsername: true },
    });
  }

  let contactRow: ContactRow | null = null;

  if (byBs && byPh) {
    if (byBs.id === byPh.id) {
      contactRow = byBs;
    } else {
      log.warn(`BSUID e telefone em contatos diferentes — priorizando BSUID (${bsuid})`);
      contactRow = byBs;
    }
  } else if (byBs) {
    contactRow = byBs;
  } else if (byPh) {
    contactRow = byPh;
  }

  if (!contactRow && phone) {
    // Fallback para bases legadas ainda NÃO normalizadas (telefone gravado
    // fora do E.164). Filtra por sufixo dos 8 dígitos do assinante — que é
    // idêntico com ou sem o 9º dígito — e confirma pela comparação de
    // variantes (que reintroduz o DDD, evitando colisão entre DDDs). Sem o
    // antigo `take: 500`, que fazia o match silenciosamente incompleto em
    // orgs grandes; `endsWith` mantém o conjunto de candidatos pequeno.
    const digits = phone.replace(/\D/g, "");
    const last8 = digits.slice(-8);
    if (last8.length === 8) {
      const variantSet = new Set(phoneMatchVariants(phone));
      const candidates = await prisma.contact.findMany({
        where: { phone: { endsWith: last8 } },
        select: { id: true, name: true, phone: true, whatsappBsuid: true, whatsappUsername: true },
      });
      const byFuzzy = candidates.find((c) =>
        phoneMatchVariants(c.phone).some((v) => variantSet.has(v)),
      );
      if (byFuzzy) contactRow = byFuzzy;
    }
  }

  // Fallback por `profile.name` REMOVIDO em 2026-06-30.
  //
  // Histórico: havia um terceiro fallback aqui — se BSUID/phone/fuzzy-phone
  // não casassem, fazia `findFirst({ name: equals(profileName) })`. A ideia
  // era recuperar contatos importados sem phone, mas o efeito real em
  // produção foi catastrófico para orgs com funil de recrutamento (DNAWork):
  // qualquer pessoa com `profile.name = "Mari"` (ou "Eduardo", "Kauã", etc.)
  // tinha suas mensagens grudadas no PRIMEIRO contato existente com aquele
  // nome — mesmo sendo um número totalmente diferente.
  //
  // Diagnóstico: 1.801 inbounds mal-roteadas em 30 dias na DNAWork,
  // afetando 429 conversas. Sintoma reportado: composer responde para o
  // phone gravado no contato (correto), mas Meta retorna `131047 Fora da
  // janela de 24h` porque o NÚMERO REAL daquele contato não enviou nada
  // — quem enviou foi outra pessoa que caiu na mesma conversa por
  // homonímia. Ver investigação em `_diag/decode_wamids.py` /
  // `_diag/estimate_damage.py` no workspace.
  //
  // Decisão: `wa_id` (E.164) é a fonte de verdade no protocolo Meta —
  // fallback por nome é fundamentalmente inseguro em qualquer escala.
  // Sem este match, números novos passam a criar contatos novos
  // (comportamento correto). Saneamento dos dados já bagunçados não é
  // feito aqui (migration separada, fora deste escopo).

  if (contactRow) {
    const updates: {
      name?: string;
      phone?: string | null;
      whatsappBsuid?: string;
      whatsappUsername?: string;
    } = {};
    if (profileName && contactRow.name.startsWith("Lead +")) {
      updates.name = sanitizeContactName(profileName) || profileName;
    } else {
      // Contatos antigos com emoji no nome: limpa na próxima mensagem.
      const cleaned = sanitizeContactName(contactRow.name);
      if (cleaned && cleaned !== contactRow.name) {
        updates.name = cleaned;
      }
    }
    if (phone && !contactRow.phone) {
      updates.phone = phone;
    }
    if (bsuid && !contactRow.whatsappBsuid) {
      updates.whatsappBsuid = bsuid;
    }
    // Backfill do @ do WhatsApp: grava sempre que o payload trouxer o
    // username e o valor mudou (o cliente pode ter adotado/trocado).
    if (username && contactRow.whatsappUsername !== username) {
      updates.whatsappUsername = username;
    }
    if (Object.keys(updates).length > 0) {
      prisma.contact
        .update({ where: { id: contactRow.id }, data: updates })
        .catch(() => {});
      contactRow = { ...contactRow, ...updates };
    }

    // Contato JÁ EXISTE: a função só auto-cria deal se ele nunca tiver
    // tido um (raro — ex.: contato importado sem deal). Se já houve
    // OPEN/WON/LOST, NÃO recria — o controle passa pras automações
    // configuradas pelo operador (trigger `message_received` com
    // filtro `dealStatus`). Isso evita re-disparar `deal_created` em
    // leads descartados ou clientes que já compraram. Ver `auto-deals.ts`
    // (changelog v3 — jun/2026).
    const existingRoutingChannelId =
      (await findChannelByPhoneNumberId(phoneNumberId))?.id ?? null;
    ensureOpenDealForContact({
      contactId: contactRow.id,
      contactName: contactRow.name,
      source: "auto_whatsapp",
      logTag: "meta-webhook",
      channelId: existingRoutingChannelId,
    }).catch((err) =>
      log.warn("Falha ao garantir deal aberto:", err),
    );

    return {
      id: contactRow.id,
      name: contactRow.name,
      phone: contactRow.phone ?? null,
      whatsappBsuid: contactRow.whatsappBsuid ?? null,
      whatsappUsername: contactRow.whatsappUsername ?? null,
    };
  }

  if (!createIfMissing) {
    log.debug(
      `resolveWebhookContact: contato não encontrado e createIfMissing=false — não criando lead`,
    );
    return null;
  }

  const name =
    (profileName ? sanitizeContactName(profileName) || profileName : null) ||
    (phone ? `Lead ${phone}` : `Lead WhatsApp (${(bsuid ?? "").slice(0, 18)}…)`);

  const sourceName = await getChannelSourceName(phoneNumberId);

  const created = await prisma.contact.create({
    data: withOrgFromCtx({
      number: await nextContactNumber(),
      name,
      ...(phone ? { phone } : {}),
      ...(bsuid ? { whatsappBsuid: bsuid } : {}),
      ...(username ? { whatsappUsername: username } : {}),
      lifecycleStage: "LEAD" as const,
      source: sourceName,
    }),
    select: { id: true, name: true, phone: true, whatsappBsuid: true, whatsappUsername: true },
  });

  // Dispara automações com trigger "contact_created" (fire-and-forget,
  // não bloqueia a resposta ao webhook da Meta, que tem janela curta
  // de retry). Precisa acontecer ANTES do auto-deal para preservar a
  // ordem semântica (contato criado → deal criado).
  fireTrigger("contact_created", {
    contactId: created.id,
    data: { source: sourceName, channel: "WhatsApp" },
  }).catch((err) =>
    log.warn("Falha no gatilho contact_created:", err),
  );

  ensureOpenDealForContact({
    contactId: created.id,
    contactName: name,
    source: "auto_whatsapp",
    logTag: "meta-webhook",
    channelId: (await findChannelByPhoneNumberId(phoneNumberId))?.id ?? null,
  }).catch((err) =>
    log.warn("Falha ao garantir deal aberto:", err),
  );

  log.info(`Novo lead: ${name} (${phone ?? bsuid})`);
  return {
    id: created.id,
    name: created.name,
    phone: created.phone ?? null,
    whatsappBsuid: created.whatsappBsuid ?? null,
    whatsappUsername: created.whatsappUsername ?? null,
  };
}

// A lógica de auto-criação de deal foi extraída para
// `src/services/auto-deals.ts` e agora é chamada TANTO quando o contato é
// novo quanto quando um contato pré-existente volta a falar — assim
// contatos importados/manuais sem deal passam a ter um ao primeiro
// inbound.

async function findOrCreateConversation(contactId: string, phoneNumberId?: string) {
  const targetChannel = await findChannelByPhoneNumberId(phoneNumberId);

  // Modelo de ticket: contatos com conversa RESOLVED geram NOVA conversa
  // na proxima mensagem inbound (nao reabre). Ver AGENT.md.
  const convSelect = {
    id: true,
    status: true,
    channelId: true,
    organizationId: true,
  } as const;
  const findActive = () =>
    prisma.conversation.findFirst({
      where: { contactId, channel: "whatsapp", status: { not: "RESOLVED" } },
      // PR 1.3: incluímos organizationId para que callers (download de
      // mídia inbound) possam roteá-lo no storage tenant-scoped.
      select: convSelect,
    });

  const existing = await findActive();

  if (existing) {
    // Reusa a conversa aberta. So reconcilia canal (para o inbox mostrar
    // que a mensagem entrou pela conta X). Nao promove status pra OPEN
    // porque agora a conversa ja e' non-RESOLVED por construcao.
    if (targetChannel && existing.channelId !== targetChannel.id) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: { channelId: targetChannel.id },
      });
    }
    return { ...existing, channelId: targetChannel?.id ?? existing.channelId };
  }

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { assignedToId: true },
  });

  try {
    return await withConversationNumberRetry((number) =>
      prisma.conversation.create({
        data: withOrgFromCtx({
          number,
          contactId,
          channel: "whatsapp",
          channelId: targetChannel?.id,
          status: "OPEN" as const,
          ...(contact?.assignedToId ? { assignedToId: contact.assignedToId } : {}),
        }),
        select: convSelect,
      }),
    );
  } catch (err) {
    // Corrida: dois webhooks/mensagens simultaneos do mesmo numero. O
    // indice unico parcial rejeita o 2o create com P2002 — reusa o
    // ticket vencedor em vez de duplicar.
    if (isActiveConversationUniqueViolation(err)) {
      const won = await findActive();
      if (won) return { ...won, channelId: targetChannel?.id ?? won.channelId };
    }
    throw err;
  }
}

// ── Extract message content ──────────────────────

type ParsedMessage = {
  waMessageId: string;
  timestamp: Date;
  type: string;
  text: string;
  mediaUrl: string | null;
  mediaId: string | null;
  mimeType: string | null;
  /**
   * Quando o cliente responde uma mensagem específica no WhatsApp, o payload
   * traz `context.id` = wamid da mensagem citada. Usamos para popular
   * `Message.replyToId`/`replyToPreview` e desenhar a citação na bolha.
   */
  replyToWaMessageId: string | null;
  /**
   * Preenchido apenas quando `type === "reaction"`: o cliente reagiu (ou
   * removeu reação) numa mensagem enviada por nós. `emoji === null` sinaliza
   * remoção. `targetWaMessageId` é o wamid da mensagem reagida.
   *
   * Quando presente, o fluxo NÃO cria uma Message nova — apenas atualiza o
   * JSON `reactions` do Message alvo. Se o alvo não existir localmente
   * (raro; typicamente uma reação numa mensagem que ainda não foi
   * sincronizada), o evento é ignorado silenciosamente.
   */
  reactionTarget: { targetWaMessageId: string; emoji: string | null } | null;
  /** ID do botão/lista (interactive) — usado p.ex. para opt-in de chamada. */
  interactiveButtonId: string | null;
  interactiveButtonTitle: string | null;
  /** Valor de `interactive.type` na Cloud API (ex. button_reply, call_permission_reply). */
  interactiveKind: string | null;
  /**
   * Quando `interactive.type = call_permission_reply`, a Meta devolve o tipo
   * da permissão concedida: "permanent" ou "temporary" (também visto como
   * `permission_duration`). Usado para setar `whatsappCallConsentType` e
   * calcular o prazo de expiração (7 dias vs. indefinido).
   */
  callPermissionType: "PERMANENT" | "TEMPORARY" | null;
  referral: ReferralInfo | null;
  /** Payload bruto do WhatsApp Flow (nfm_reply) para gravar no lead. */
  flowPayload: Record<string, unknown> | null;
  flowMetaName: string | null;
  flowToken: string | null;
};

function fallbackUnknownInteractive(
  kind: string | null,
  inter: Record<string, unknown>
): string {
  for (const [key, val] of Object.entries(inter)) {
    if (key === "type") continue;
    const o = obj(val);
    const t = str(o.title) || str(o.description) || str(o.text) || str(o.name);
    if (t) return t;
    const id = str(o.id);
    if (id && kind) return `Seleção (${kind}): ${id}`;
  }
  if (kind) return `Resposta interativa (${kind})`;
  return "[interactive]";
}

/** Extrai texto legível de `messages[].interactive` (botões, lista, permissão de ligação, flow/NFM). */
function parseInteractiveBlock(inter: Record<string, unknown>): {
  text: string;
  interactiveKind: string | null;
  interactiveButtonId: string | null;
  interactiveButtonTitle: string | null;
  callPermissionType: "PERMANENT" | "TEMPORARY" | null;
  flowPayload: Record<string, unknown> | null;
  flowMetaName: string | null;
  flowToken: string | null;
} {
  const interactiveKind = str(inter.type) || null;

  const btnReply = obj(inter.button_reply);
  const listReply = obj(inter.list_reply);
  let interactiveButtonId = str(btnReply.id) || str(listReply.id) || null;
  let interactiveButtonTitle = str(btnReply.title) || str(listReply.title) || null;

  let cpr = obj(inter.call_permission_reply);
  if (Object.keys(cpr).length === 0) cpr = obj(inter.call_permission);
  let fromCallPermission = "";
  let callPermissionType: "PERMANENT" | "TEMPORARY" | null = null;
  if (Object.keys(cpr).length > 0) {
    const resp = (
      str(cpr.response) ||
      str(cpr.call_permission_response) ||
      str(cpr.status) ||
      ""
    ).toUpperCase();
    const permType = (
      str(cpr.permission_type) ||
      str(cpr.permission_duration) ||
      ""
    ).toLowerCase();

    if (
      resp === "GRANTED" ||
      resp === "ACCEPT" ||
      resp === "ACCEPTED" ||
      resp === "APPROVED" ||
      resp === "ALLOW"
    ) {
      const isPermanent = permType.includes("permanent") || permType.includes("permanen");
      callPermissionType = isPermanent ? "PERMANENT" : "TEMPORARY";
      fromCallPermission = isPermanent
        ? "✅ Cliente aceitou: permissão permanente para ligações."
        : "✅ Cliente aceitou: permissão para ligações por 7 dias.";
    } else if (
      resp === "REJECT" ||
      resp === "REJECTED" ||
      resp === "DECLINE" ||
      resp === "DECLINED" ||
      resp === "DENY" ||
      resp === "DENIED" ||
      resp === "BLOCK" ||
      resp === "BLOCKED"
    ) {
      fromCallPermission = "❌ Cliente recusou o pedido de permissão para ligações.";
    } else if (resp || permType) {
      fromCallPermission = `📞 Resposta ao pedido de ligações: ${[resp, permType].filter(Boolean).join(" · ")}`;
    } else {
      const brief = Object.entries(cpr)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(", ");
      fromCallPermission = brief
        ? `📞 Permissão de ligação (${brief.slice(0, 180)}${brief.length > 180 ? "…" : ""})`
        : "📞 Resposta ao pedido de permissão para ligações.";
    }
  }

  // Resposta de WhatsApp Flow vem em duas formas no webhook da Meta:
  //   1. `interactive.type = "nfm_reply"` (Native Form Message Reply — Cloud API)
  //   2. `interactive.type = "flow_reply"` (variante mais antiga, ainda vista)
  // Em ambos os casos, `body` literal vem "Sent" e os valores preenchidos
  // ficam em `response_json` (string JSON). Formatamos como "Campo: valor"
  // por linha pra que o operador leia direto no chat.
  let flowPayload: Record<string, unknown> | null = null;
  let flowMetaName: string | null = null;
  let flowToken: string | null = null;

  const nfm = obj(inter.nfm_reply);
  let fromNfm = "";
  if (Object.keys(nfm).length > 0) {
    // Log estruturado do payload bruto pra debugging — ajuda a entender
    // se Meta está mandando `response_json` ou apenas `body`. Em produção
    // estável esse log pode ser removido; mantido por enquanto pra dar
    // visibilidade sobre fluxos que ainda chegam vazios.
    log.info("[whatsapp-flow] nfm_reply recebido", {
      keys: Object.keys(nfm),
      name: str(nfm.name) || null,
      body: str(nfm.body) || null,
      response_json_type: typeof nfm.response_json,
      response_json_preview:
        typeof nfm.response_json === "string"
          ? nfm.response_json.slice(0, 500)
          : nfm.response_json
            ? JSON.stringify(nfm.response_json).slice(0, 500)
            : null,
    });
    const parsedFlow = parseWhatsappFlowResponsePayload(nfm);
    if (parsedFlow) {
      flowPayload = parsedFlow.payload;
      flowMetaName = parsedFlow.flowMetaName;
      flowToken = parsedFlow.flowToken;
    }
    const formatted = formatWhatsappFlowResponse(nfm);
    if (formatted) {
      fromNfm = formatted;
    } else {
      const b = str(nfm.body);
      fromNfm = b && b.toLowerCase() !== "sent"
        ? `Fluxo (resposta): ${b.slice(0, 400)}${b.length > 400 ? "…" : ""}`
        : "📋 Resposta do formulário recebida (sem campos).";
    }
  }

  const flowReply = obj(inter.flow_reply);
  let fromFlow = "";
  if (Object.keys(flowReply).length > 0) {
    log.info("[whatsapp-flow] flow_reply recebido", {
      keys: Object.keys(flowReply),
      name: str(flowReply.name) || null,
      body: str(flowReply.body) || null,
      response_json_type: typeof flowReply.response_json,
      response_json_preview:
        typeof flowReply.response_json === "string"
          ? flowReply.response_json.slice(0, 500)
          : flowReply.response_json
            ? JSON.stringify(flowReply.response_json).slice(0, 500)
            : null,
    });
    const parsedFlow = parseWhatsappFlowResponsePayload(flowReply);
    if (parsedFlow) {
      flowPayload = parsedFlow.payload;
      flowMetaName = parsedFlow.flowMetaName ?? flowMetaName;
      flowToken = parsedFlow.flowToken ?? flowToken;
    }
    const formatted = formatWhatsappFlowResponse(flowReply);
    if (formatted) {
      fromFlow = formatted;
    } else {
      const body = str(flowReply.body);
      fromFlow = body && body.toLowerCase() !== "sent"
        ? `Fluxo: ${body.slice(0, 400)}${body.length > 400 ? "…" : ""}`
        : "📋 Resposta do formulário recebida (sem campos).";
    }
  }

  let text =
    interactiveButtonTitle ||
    fromCallPermission ||
    fromNfm ||
    fromFlow ||
    str(inter.body) ||
    "";

  if (!text && interactiveButtonId) {
    text = `Botão selecionado (id: ${interactiveButtonId})`;
  }

  if (!text) {
    text = fallbackUnknownInteractive(interactiveKind, inter);
  }

  return {
    text,
    interactiveKind,
    interactiveButtonId,
    interactiveButtonTitle,
    callPermissionType,
    flowPayload,
    flowMetaName,
    flowToken,
  };
}

function parseMessage(message: Record<string, unknown>): ParsedMessage | null {
  const id = str(message.id);
  const ts = str(message.timestamp);
  const type = str(message.type);
  if (!id || !type) return null;

  const timestamp = ts
    ? new Date(Number(ts) * 1000)
    : new Date();

  let text = "";
  let mediaUrl: string | null = null;
  let mediaId: string | null = null;
  let mimeType: string | null = null;
  let interactiveButtonId: string | null = null;
  let interactiveButtonTitle: string | null = null;
  let interactiveKind: string | null = null;
  let callPermissionType: "PERMANENT" | "TEMPORARY" | null = null;
  let flowPayload: Record<string, unknown> | null = null;
  let flowMetaName: string | null = null;
  let flowToken: string | null = null;

  switch (type) {
    case "text": {
      const t = obj(message.text);
      text = str(t.body);
      break;
    }
    case "image": {
      const m = obj(message.image);
      text = str(m.caption) || "[Imagem]";
      mediaId = str(m.id) || null;
      mimeType = str(m.mime_type) || "image/jpeg";
      break;
    }
    case "video": {
      const m = obj(message.video);
      text = str(m.caption) || "[Vídeo]";
      mediaId = str(m.id) || null;
      mimeType = str(m.mime_type) || "video/mp4";
      break;
    }
    case "audio": {
      const m = obj(message.audio);
      text = "[Áudio]";
      mediaId = str(m.id) || null;
      mimeType = str(m.mime_type) || "audio/ogg";
      break;
    }
    case "document": {
      const m = obj(message.document);
      text = str(m.caption) || str(m.filename) || "[Documento]";
      mediaId = str(m.id) || null;
      mimeType = str(m.mime_type) || "application/octet-stream";
      break;
    }
    case "sticker": {
      text = "[Sticker]";
      const m = obj(message.sticker);
      mediaId = str(m.id) || null;
      mimeType = str(m.mime_type) || "image/webp";
      break;
    }
    case "location": {
      const m = obj(message.location);
      text = `📍 ${m.latitude}, ${m.longitude}`;
      break;
    }
    case "contacts": {
      text = "[Contato compartilhado]";
      break;
    }
    case "reaction": {
      // Reação do cliente numa mensagem nossa. Payload da Meta:
      //   { type: "reaction", reaction: { message_id, emoji } }
      // `emoji` vazio = cliente removeu a reação (WhatsApp permite).
      const r = obj(message.reaction);
      const targetWaMessageId = str(r.message_id);
      if (!targetWaMessageId) return null;
      const rawEmoji = str(r.emoji);
      // Cai para bloco de retorno abaixo com reactionTarget preenchido.
      // Marcamos o text para o log de debug; ele não é persistido.
      text = rawEmoji ? `Reagiu com ${rawEmoji}` : "Removeu reação";
      return {
        waMessageId: id,
        timestamp,
        type,
        text,
        mediaUrl: null,
        mediaId: null,
        mimeType: null,
        replyToWaMessageId: null,
        reactionTarget: {
          targetWaMessageId,
          emoji: rawEmoji || null,
        },
        interactiveButtonId: null,
        interactiveButtonTitle: null,
        interactiveKind: null,
        callPermissionType: null,
        referral: null,
        flowPayload: null,
        flowMetaName: null,
        flowToken: null,
      };
    }
    case "interactive": {
      const inter = obj(message.interactive);
      const parsedInter = parseInteractiveBlock(inter);
      text = parsedInter.text;
      interactiveKind = parsedInter.interactiveKind;
      interactiveButtonId = parsedInter.interactiveButtonId;
      interactiveButtonTitle = parsedInter.interactiveButtonTitle;
      callPermissionType = parsedInter.callPermissionType;
      flowPayload = parsedInter.flowPayload;
      flowMetaName = parsedInter.flowMetaName;
      flowToken = parsedInter.flowToken;
      break;
    }
    case "button": {
      const btn = obj(message.button);
      interactiveButtonId = str(btn.payload) || null;
      interactiveButtonTitle = str(btn.text) || null;
      text = interactiveButtonTitle || "[button]";
      break;
    }
    case "system": {
      // WhatsApp Cloud API: eventos de plataforma (ex.: cliente mudou de número).
      // Ref: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/system
      const sys = obj(message.system);
      const body = str(sys.body);
      const sysType = str(sys.type);
      if (body) {
        text = body;
      } else if (sysType) {
        text = `[Sistema WhatsApp: ${sysType}]`;
      } else {
        text = "[Evento do sistema WhatsApp]";
      }
      break;
    }
    default:
      text = `[${type}]`;
  }

  const referral = parseReferral(message);

  // Contexto de resposta: quando o cliente responde uma mensagem específica,
  // a Meta envia `context.id` = wamid da mensagem citada. Ignoramos o resto
  // do contexto (from, forwarded, referred_product) por enquanto — só
  // usamos o id para linkar via replyToId no Message local.
  const context = obj(message.context);
  const replyToWaMessageId = str(context.id) || null;

  return {
    waMessageId: id,
    timestamp,
    type,
    text,
    mediaUrl,
    mediaId,
    mimeType,
    replyToWaMessageId,
    reactionTarget: null,
    interactiveButtonId,
    interactiveButtonTitle,
    interactiveKind,
    callPermissionType,
    referral,
    flowPayload,
    flowMetaName,
    flowToken,
  };
}

// ── Download media from Meta & save locally ──────

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
  "audio/ogg": "ogg", "audio/ogg; codecs=opus": "ogg", "audio/mpeg": "mp3",
  "audio/mp4": "m4a", "audio/amr": "amr", "audio/aac": "aac",
  "video/mp4": "mp4", "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/vnd.ms-powerpoint": "ppt",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function mimeToExt(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return MIME_EXT[base] ?? base.split("/").pop()?.replace(/[^a-z0-9]/g, "") ?? "bin";
}

async function resolveAccessToken(phoneNumberId?: string): Promise<string | null> {
  if (phoneNumberId) {
    const ch = await findChannelByPhoneNumberId(phoneNumberId);
    if (ch) {
      const cfg = ch.config as Record<string, unknown> | null;
      const raw = typeof cfg?.accessToken === "string" ? cfg.accessToken.trim() : "";
      if (raw) {
        try {
          const token = decryptSecret(raw).trim();
          if (token) return token;
        } catch (err) {
          log.error(
            `Falha ao decifrar accessToken do canal ${ch.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  }
  return process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() ?? null;
}

async function downloadAndSaveMedia(
  mediaId: string,
  mimeType: string | null,
  organizationId: string,
  phoneNumberId?: string,
): Promise<string | null> {
  const token = await resolveAccessToken(phoneNumberId);
  if (!token || !mediaId) return null;

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (!metaRes.ok) {
      log.warn(`Falha ao obter URL da mídia ${mediaId}: HTTP ${metaRes.status}`);
      return null;
    }
    const urlData = (await metaRes.json()) as { url?: string };
    const downloadUrl = urlData.url;
    if (!downloadUrl) return null;

    const fileRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!fileRes.ok) {
      log.warn(`Falha ao baixar mídia ${mediaId}: HTTP ${fileRes.status}`);
      return null;
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    const ext = mimeToExt(mimeType || "application/octet-stream");
    const fileName = generateFileName({ prefix: "in", ext });
    // PR 1.3: storage por org. Antes: `public/uploads/<file>` shared.
    const saved = await saveFile({
      orgId: organizationId,
      bucket: "inbound-media",
      fileName,
      buffer,
    });

    log.debug(
      `Mídia ${mediaId} salva (${(buffer.length / 1024).toFixed(1)} KB) em ${saved.url}`,
    );
    return saved.url;
  } catch (err) {
    log.error("Erro ao baixar mídia da Meta:", err);
    return null;
  }
}

// ── Status updates ───────────────────────────────

const VALID_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

async function processStatusUpdate(status: Record<string, unknown>) {
  const wamid = str(status.id);
  const s = str(status.status);
  if (!wamid || !s) return;

  if (!VALID_STATUSES.has(s)) {
    log.debug(`Status ignorado ${wamid} → ${s}`);
    return;
  }

  try {
    const msg = await prisma.message.findFirst({
      where: { externalId: wamid },
      select: {
        id: true,
        sendStatus: true,
        conversationId: true,
        organizationId: true,
        externalId: true,
      },
    });
    if (!msg) {
      // Status chegou antes do externalId ser gravado (race raro) ou
      // wamid desconhecido — sem mensagem não há o que atualizar na UI.
      log.info(`Status ${s} ignorado: mensagem externalId=${wamid} não encontrada`);
      await updateCampaignRecipientStatus(wamid, s, status);
      return;
    }

    // Progressão normal: pending(0) → sent(1) → delivered(2) → read(3).
    // "failed" NÃO entra nessa escala — é um estado terminal que
    // SEMPRE deve sobrepor, porque a Meta pode mandar `sent` no ACK
    // inicial e minutos depois `failed` (cliente bloqueou, janela de
    // 24h expirou na entrega, número inválido, etc). Antes o código
    // tratava failed como prioridade 0 e descartava esse callback,
    // deixando a UI eternamente com ✓ mesmo após a falha real.
    const statusPriority: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
    // Normaliza caso (outros caminhos podem gravar SENT/DELIVERED/READ).
    const currentPriority =
      statusPriority[(msg.sendStatus ?? "").toLowerCase()] ?? 0;
    const newPriority = statusPriority[s] ?? 0;

    const isFailure = s === "failed";
    const shouldUpdate = isFailure
      ? (msg.sendStatus ?? "").toLowerCase() !== "failed"
      : newPriority > currentPriority;

    if (shouldUpdate) {
        // Estrutura oficial do erro do webhook (Meta docs):
        //   errors[i] = { code, title, message, error_data: { details }, href }
        // Recomendação Meta: usar `code` como chave de lógica, `error_data.details`
        // como texto mais acionável (ex.: "Message failed to send because more than
        // 24 hours have passed since the customer last replied to this number"),
        // e `href` como link oficial pra diagnosticar. `title` pode ser deprecado.
        const errorInfo = isFailure
          ? (() => {
              const errors = arr(status.errors);
              if (errors.length === 0) return null;
              const e = obj(errors[0]);
              const code = typeof e.code === "number" ? e.code : null;
              const title = str(e.title);
              const message = str(e.message);
              const details = str(obj(e.error_data).details);
              const href = str(e.href);
              // Prioriza details (texto acionável) > message > title.
              const rawHuman = details || message || title || "Falha no envio";
              // Traduz para PT-BR pelo `code` catalogado (mesma convenção do
              // envio imediato em MetaGraphError.toPersistedString): mostra o
              // motivo em português e mantém o texto original da Meta entre
              // parênteses para diagnóstico.
              const ptReason = metaErrorReason(code);
              const human = ptReason ? `${ptReason} (Meta: ${rawHuman})` : rawHuman;
              const metaParts: string[] = [];
              if (code != null) metaParts.push(`code ${code}`);
              return {
                text:
                  metaParts.length > 0
                    ? `${human} (${metaParts.join(", ")})`
                    : human,
                code,
                title,
                details,
                href,
              };
            })()
          : null;

        const sendError = errorInfo?.text ?? (isFailure ? "Falha no envio" : null);

        await prisma.message.update({
          where: { id: msg.id },
          data: {
            sendStatus: s,
            ...(isFailure ? { sendError } : {}),
          },
        });

        if (isFailure) {
          await prisma.conversation
            .update({
              where: { id: msg.conversationId },
              data: { hasError: true },
            })
            .catch(() => {});
          log.warn(
            `Mensagem ${wamid} falhou no envio: code=${errorInfo?.code ?? "?"} title="${errorInfo?.title ?? ""}" details="${errorInfo?.details ?? ""}" href=${errorInfo?.href ?? "-"}`,
          );
          // Falha reportada pela Meta é sinal forte de problema no
          // número (quality rating, limite, flag). Força refresh do
          // healthcheck pra banner aparecer rápido no dashboard.
          try {
            const { refreshWhatsAppHealth } = await import(
              "@/services/whatsapp-health"
            );
            refreshWhatsAppHealth();
          } catch {
            // best-effort
          }

          // Activity Log: registra a falha no feed unificado (/logs) e nas
          // estatisticas. Fire-and-forget — nao bloqueia o webhook.
          void (async () => {
            const conv = await prisma.conversation
              .findUnique({
                where: { id: msg.conversationId },
                select: {
                  contactId: true,
                  contact: { select: { name: true, phone: true } },
                },
              })
              .catch(() => null);
            const openDeal = conv?.contactId
              ? await prisma.deal
                  .findFirst({
                    where: { contactId: conv.contactId, status: "OPEN" },
                    select: { id: true },
                    orderBy: { updatedAt: "desc" },
                  })
                  .catch(() => null)
              : null;
            await logMessageFailed({
              messageId: msg.id,
              conversationId: msg.conversationId,
              contactId: conv?.contactId ?? null,
              dealId: openDeal?.id ?? null,
              contactLabel: conv?.contact?.name ?? null,
              contactSublabel: conv?.contact?.phone ?? null,
              error: sendError,
              source: "meta",
              errorCode: errorInfo?.code ?? null,
              channel: "WhatsApp",
            });
          })();
        }

        // O GET /messages expõe id = externalId ?? id (id da bolha no
        // front). Se publicarmos só o UUID interno, o update otimista
        // nunca casa e os ticks só mudam no refetch/poll.
        const bubbleId = msg.externalId ?? msg.id;
        const orgId = getOrgIdOrNull() ?? msg.organizationId;
        try {
          sseBus.publish("message_status", {
            organizationId: orgId,
            conversationId: msg.conversationId,
            messageId: bubbleId,
            internalId: msg.id,
            status: s,
            ...(isFailure && sendError ? { error: sendError } : {}),
          });
        } catch {}

        if (s === "read") {
          log.info(
            `Mensagem lida wamid=${wamid} conversationId=${msg.conversationId} bubbleId=${bubbleId}`,
          );
        }
    }

    await updateCampaignRecipientStatus(wamid, s, status);

    log.debug(`Status ${wamid} → ${s}`);
  } catch (err) {
    log.warn("Erro ao atualizar status da mensagem:", err);
  }
}

async function updateCampaignRecipientStatus(
  metaMessageId: string,
  status: string,
  raw: Record<string, unknown>,
) {
  try {
    const recipient = await prisma.campaignRecipient.findFirst({
      where: { metaMessageId },
      select: { id: true, status: true, campaignId: true },
    });
    if (!recipient) return;

    const statusMap: Record<string, string> = {
      sent: "SENT",
      delivered: "DELIVERED",
      read: "READ",
      failed: "FAILED",
    };
    const newStatus = statusMap[status];
    if (!newStatus) return;

    const priority: Record<string, number> = { PENDING: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 0 };
    if ((priority[newStatus] ?? 0) <= (priority[recipient.status] ?? 0) && newStatus !== "FAILED") return;

    const data: Record<string, unknown> = { status: newStatus };
    if (status === "delivered") data.deliveredAt = new Date();
    if (status === "read") data.readAt = new Date();
    if (status === "failed") {
      const errors = arr(raw.errors);
      const e = errors.length > 0 ? obj(errors[0]) : {};
      const details = str(obj(e.error_data).details);
      const code = typeof e.code === "number" ? e.code : null;
      const human =
        details || str(e.message) || str(e.title) || "Falha no envio";
      data.errorMessage =
        code != null ? `${human} (code ${code})` : human;
    }

    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data,
    });

    const counterField = status === "delivered"
      ? "deliveredCount"
      : status === "read"
        ? "readCount"
        : status === "failed" && recipient.status !== "FAILED"
          ? "failedCount"
          : null;

    if (counterField) {
      await prisma.campaign.update({
        where: { id: recipient.campaignId },
        data: { [counterField]: { increment: 1 } },
      });
    }
  } catch (err) {
    log.warn("Erro ao atualizar destinatário da campanha:", err);
  }
}

// ── GET: Webhook verification ────────────────────

function timingSafeStringEqual(a: string, b: string): boolean {
  // Compara strings em tempo constante para o tamanho da menor delas;
  // evita timing attack vazando o tamanho/conteúdo do verify token.
  if (a.length === 0 || b.length === 0) return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function handleMetaWebhookGet(
  request: Request,
  scope?: WebhookScope,
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (scope) {
    // Multi-tenant: valida contra Channel.config.verifyToken DESSA org.
    // Usa prismaBase pra rodar cross-org sem precisar abrir context (so
    // estamos lendo o config do channel pra autenticar o handshake da Meta).
    const channels = await prismaBase.channel.findMany({
      where: {
        organizationId: scope.organizationId,
        type: "WHATSAPP",
        provider: "META_CLOUD_API",
      },
      select: { id: true, name: true, config: true },
    });
    // PR-1.2: verifyToken pode estar encriptado (enc:v1:...) ou plaintext
    // (canais antigos pre-backfill). Decripta defensivamente em ambos os casos.
    const tokens = channels
      .map((c) => {
        const cfg = c.config as Record<string, unknown> | null;
        const raw = typeof cfg?.verifyToken === "string" ? cfg.verifyToken.trim() : "";
        if (!raw) return "";
        if (!isEncryptedSecret(raw)) return raw;
        try {
          return decryptSecret(raw);
        } catch (err) {
          log.error(
            `Falha ao decriptar verifyToken do canal ${c.id}: ${err instanceof Error ? err.message : err}`,
          );
          return "";
        }
      })
      .filter((t) => t.length > 0);

    // Fallback: canais provisionados via App Meta global do CRM (conexao
    // manual token-based / embedded signup) NAO gravam verifyToken proprio —
    // o handshake da Meta usa o META_WEBHOOK_VERIFY_TOKEN global do env,
    // configurado uma unica vez no painel do App Meta do CRM. Aceitamos
    // tanto per-channel (canais legacy Opcao B) quanto o global.
    if (VERIFY_TOKEN) tokens.push(VERIFY_TOKEN);

    if (tokens.length === 0) {
      log.error(
        `org="${scope.organizationSlug}" sem verifyToken cadastrado em nenhum canal Meta e sem META_WEBHOOK_VERIFY_TOKEN global — recusando verificacao`,
      );
      return NextResponse.json(
        { error: "verifyToken not configured" },
        { status: 503 },
      );
    }

    if (
      mode === "subscribe" &&
      token &&
      tokens.some((t) => timingSafeStringEqual(token, t))
    ) {
      log.info(`Verificacao do webhook Meta: OK (org=${scope.organizationSlug})`);
      return new Response(challenge ?? "", { status: 200 });
    }

    log.warn(
      `Verificacao FAIL (org=${scope.organizationSlug}, mode=${mode}, token len=${token?.length ?? 0})`,
    );
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Legacy (sem slug): aceita VERIFY_TOKEN global (env) OU qualquer
  // Channel.config.verifyToken de qualquer canal Meta (any-match).
  // Fluxo novo: /api/channels/manual-cloud grava verifyToken per-channel
  // e o cliente configura no painel Meta a URL slugless — este ramo
  // valida contra todos os canais (mesma logica do collectAppSecrets).
  const legacyTokens: string[] = [];
  if (VERIFY_TOKEN) legacyTokens.push(VERIFY_TOKEN);
  try {
    const channels = await prismaBase.channel.findMany({
      where: { type: "WHATSAPP", provider: "META_CLOUD_API" },
      select: { id: true, config: true },
    });
    for (const c of channels) {
      const cfg = c.config as Record<string, unknown> | null;
      const raw = typeof cfg?.verifyToken === "string" ? cfg.verifyToken.trim() : "";
      if (!raw) continue;
      let secret = raw;
      if (isEncryptedSecret(raw)) {
        try {
          secret = decryptSecret(raw);
        } catch (err) {
          log.error(
            `Falha ao decriptar verifyToken do canal ${c.id}: ${err instanceof Error ? err.message : err}`,
          );
          continue;
        }
      }
      if (secret) legacyTokens.push(secret);
    }
  } catch (e) {
    log.warn("Erro ao buscar verifyTokens dos canais (legacy GET):", e);
  }

  if (legacyTokens.length === 0) {
    log.error("Nenhum verifyToken configurado (env META_WEBHOOK_VERIFY_TOKEN nem Channel.config.verifyToken) — verificacao desabilitada");
    return NextResponse.json(
      { error: "Webhook verification not configured" },
      { status: 503 },
    );
  }

  if (mode === "subscribe" && token && legacyTokens.some((t) => timingSafeStringEqual(token, t))) {
    log.info(`Verificação do webhook Meta: OK (legacy, ${legacyTokens.length} token(s) testado(s))`);
    return new Response(challenge ?? "", { status: 200 });
  }

  log.warn("Verificação do webhook Meta falhou:", { mode, token: token?.slice(0, 6), triedTokens: legacyTokens.length });
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ── POST: Receive messages ───────────────────────

async function collectAppSecrets(scope?: WebhookScope): Promise<string[]> {
  const secrets = new Set<string>();

  // Inclui SEMPRE o CRM_META_APP_SECRET global — desde a introducao da
  // conexao manual token-based (App Meta global do CRM, igual Datacrazy),
  // canais podem ser assinados via subscribed_apps ao app do CRM e portanto
  // suas mensagens chegam assinadas com o secret global. Canais legacy
  // (com App Secret proprio no config) continuam sendo aceitos pelo
  // collector abaixo — o verifier testa multiplos secrets ate encontrar um
  // que valide (any-match).
  if (CRM_META_APP_SECRET) secrets.add(CRM_META_APP_SECRET);

  try {
    // Usa prismaBase sempre: no path scoped filtramos por organizationId
    // explicitamente; no path legacy (sem slug — agora padrao oficial da
    // conexao manual token-based) buscamos cross-org e o handler routeia
    // pelo phone_number_id do payload. prismaBase evita a exigencia de
    // RequestContext ativo da Prisma extension.
    const where = scope
      ? {
          organizationId: scope.organizationId,
          type: "WHATSAPP" as const,
          provider: "META_CLOUD_API" as const,
        }
      : { type: "WHATSAPP" as const, provider: "META_CLOUD_API" as const };
    const channels = await prismaBase.channel.findMany({
      where,
      select: { config: true },
    });
    for (const ch of channels) {
      const cfg = ch.config as Record<string, unknown> | null;
      const raw = typeof cfg?.appSecret === "string" ? cfg.appSecret.trim() : "";
      if (!raw) continue;
      // PR-1.2: appSecret pode estar encriptado ou plaintext (back-compat).
      let secret = raw;
      if (isEncryptedSecret(raw)) {
        try {
          secret = decryptSecret(raw);
        } catch (err) {
          log.error(
            `Falha ao decriptar appSecret de canal Meta: ${err instanceof Error ? err.message : err}`,
          );
          continue;
        }
      }
      if (secret) secrets.add(secret);
    }
  } catch (e) {
    log.warn("Erro ao buscar appSecrets dos canais:", e);
  }
  return [...secrets];
}

export async function handleMetaWebhookPost(
  request: Request,
  scope?: WebhookScope,
): Promise<Response> {
  // Quando ha scope explicito na URL (/api/webhooks/meta/<slug>), usa direto.
  if (scope) {
    return withSystemContext(scope.organizationId, () =>
      executePostBody(request, scope),
    );
  }

  // Path slugless (padrao oficial da conexao manual token-based): tem que
  // resolver a org DO PAYLOAD (phone_number_id -> Channel.organizationId)
  // ANTES de executar, pra que todas as queries scoped downstream tenham
  // RequestContext. Consumimos o body aqui e reconstruimos a Request pro
  // executor poder re-ler rawBody pra validacao de assinatura.
  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch (err) {
    log.error("Erro ao ler body do webhook Meta:", err);
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  let inferredScope: WebhookScope | undefined;
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const phoneNumberId = extractFirstPhoneNumberId(parsed);
    if (phoneNumberId) {
      const channel = await prismaBase.channel.findFirst({
        where: {
          type: "WHATSAPP",
          provider: "META_CLOUD_API",
          config: { path: ["phoneNumberId"], equals: phoneNumberId },
        },
        select: { organizationId: true, organization: { select: { slug: true } } },
      });
      if (channel) {
        inferredScope = {
          organizationId: channel.organizationId,
          organizationSlug: channel.organization?.slug ?? "",
        };
      } else {
        log.debug(
          `Legacy POST: phone_number_id=${phoneNumberId} nao mapeado a nenhum canal — ignorando`,
        );
      }
    }
  } catch (err) {
    log.warn("Legacy POST: falha ao parsear body pra inferir org:", err);
  }

  // Rebuild a request equivalent que o executor consegue re-ler.
  const rebuilt = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bodyText,
  });

  if (inferredScope) {
    return withSystemContext(inferredScope.organizationId, () =>
      executePostBody(rebuilt, inferredScope),
    );
  }

  // Sem canal correspondente ao phone_number_id do payload: nao ha
  // como resolver a org, entao NAO tentamos validar assinatura contra
  // segredos agregados de todas as orgs (isso permitiria a um atacante
  // que obteve o appSecret de uma org forjar payloads "de outra org"
  // usando um phone_number_id desconhecido). Aceitamos apenas se a
  // assinatura casar com o CRM_META_APP_SECRET global (App do CRM) —
  // caso legitimo de canal ainda nao onboarded / desprovisionado.
  const sig = rebuilt.headers.get("x-hub-signature-256");
  if (CRM_META_APP_SECRET && sig && verifyMetaWebhookSignature(bodyText, sig, CRM_META_APP_SECRET)) {
    log.debug(
      "Legacy POST sem org resolvida — assinatura casou com CRM_META_APP_SECRET; auditando sem processar.",
    );
    return NextResponse.json({ status: "ignored_unmapped_channel" });
  }
  log.warn(
    "Legacy POST sem canal correspondente ao phone_number_id — recusando (nao processavel sem org).",
  );
  return NextResponse.json({ status: "ignored_unmapped_channel" }, { status: 200 });
}

function extractFirstPhoneNumberId(body: Record<string, unknown>): string | null {
  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const changes = Array.isArray(e.changes) ? e.changes : [];
    for (const change of changes) {
      const ch = (change ?? {}) as Record<string, unknown>;
      const value = (ch.value ?? {}) as Record<string, unknown>;
      const metadata = (value.metadata ?? {}) as Record<string, unknown>;
      const pid = typeof metadata.phone_number_id === "string"
        ? metadata.phone_number_id.trim()
        : "";
      if (pid) return pid;
    }
  }
  return null;
}

async function executePostBody(
  request: Request,
  scope: WebhookScope | undefined,
): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  log.debug(`POST recebido (${rawBody.length} bytes, assinatura=${signature ? "sim" : "não"}, scope=${scope?.organizationSlug ?? "(legacy)"})`);

  const secrets = await collectAppSecrets(scope);
  let signatureValid = false;
  if (secrets.length > 0) {
    signatureValid = secrets.some((s) =>
      verifyMetaWebhookSignature(rawBody, signature, s),
    );
    if (!signatureValid) {
      log.warn(
        `Assinatura inválida (${secrets.length} secret(s) testado(s)) — verifique CRM_META_APP_SECRET / channel.config.appSecret`,
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (REQUIRE_SIGNATURE) {
    // Em produção, NUNCA aceitar webhook sem App Secret configurado —
    // qualquer um na internet pode forjar payload "do Meta" e injetar
    // mensagens fake, criar contatos, disparar automações etc.
    log.error("PROD sem App Secret — recusando POST (configure META_APP_SECRET ou channel.config.appSecret)");
    return NextResponse.json(
      { error: "Webhook signature verification not configured" },
      { status: 503 },
    );
  } else {
    log.debug("Nenhum App Secret configurado — assinatura não verificada (dev/preview)");
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Auditoria: persistir TODOS os POSTs Meta com payload bruto integral.
  // Linkamos depois com automation_logs via context.data.metaWebhookEventId
  // para exibir o JSON original do webhook na UI da automação.
  const metaWebhookEventId = await createMetaWebhookEvent({
    rawBody: body,
    headers: pickWebhookHeaders(request.headers),
    signatureValid,
    scope,
  });

  const object = str(body.object);
  if (object !== "whatsapp_business_account") {
    if (metaWebhookEventId) {
      await markWebhookEventProcessed(metaWebhookEventId, "object_ignored");
    }
    return NextResponse.json({ status: "ignored" });
  }

  const entries = arr(body.entry);

  for (const entry of entries) {
    const e = obj(entry);
    const changes = arr(e.changes);

    for (const change of changes) {
      const ch = obj(change);
      const field = str(ch.field);
      const value = obj(ch.value);
      const metadata = obj(value.metadata);
      const phoneNumberId = str(metadata.phone_number_id);

      if (phoneNumberId) {
        const isKnown = await isKnownPhoneNumberId(phoneNumberId);
        if (!isKnown) {
          const envPhoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "(none)";
          const knownChannels = await prisma.channel.findMany({
            where: { type: "WHATSAPP", provider: "META_CLOUD_API" },
            select: { id: true, name: true, config: true },
          });
          const knownIds = knownChannels
            .map((ch) => {
              const cfg = (ch.config ?? {}) as Record<string, unknown>;
              const id = typeof cfg.phoneNumberId === "string" ? cfg.phoneNumberId : null;
              return id ? `${ch.name}=${id}` : `${ch.name}=(nenhum)`;
            })
            .join(", ");
          log.debug(
            `phone_number_id="${phoneNumberId}" não reconhecido — número não cadastrado como canal. env=${envPhoneId}. Canais: [${knownIds || "(nenhum)"}]`,
          );
          continue;
        }
      } else {
        log.debug("metadata.phone_number_id ausente no payload");
      }

      if (field === "calls") {
        try {
          await processMetaWhatsappCallsWebhook(value, phoneNumberId, {
            resolveWebhookContact,
            findOrCreateConversation,
          });
        } catch (err) {
          log.error("Erro ao processar webhook de chamadas:", err);
        }
        continue;
      }

      if (field !== "messages") continue;

      const contacts = arr(value.contacts);
      const messages = arr(value.messages);
      const statuses = arr(value.statuses);

      for (const s of statuses) {
        await processStatusUpdate(obj(s));
      }

      const contactMap = new Map<string, string>();
      // @ do WhatsApp: `contacts[].profile.username` (só presente quando o
      // usuário adotou username). Chaveamos por wa_id e user_id igual ao nome.
      const usernameMap = new Map<string, string>();
      for (const c of contacts) {
        const co = obj(c);
        const waId = str(co.wa_id);
        const userId = str(co.user_id);
        const profile = obj(co.profile);
        const name = str(profile.name) || str(profile.username);
        const username = str(profile.username);
        if (waId && name) contactMap.set(waId, name);
        if (userId && name) contactMap.set(userId, name);
        if (waId && username) usernameMap.set(waId, username);
        if (userId && username) usernameMap.set(userId, username);
      }

      for (const msg of messages) {
        const m = obj(msg);
        const msgType = str(m.type);
        let from = str(m.from);
        let fromUserId = str(m.from_user_id);
        if (!from && !fromUserId && msgType === "system") {
          const sys = obj(m.system);
          const sysWa = str(sys.wa_id);
          const sysUid = str(sys.user_id);
          if (sysWa) from = sysWa;
          if (sysUid) fromUserId = sysUid;
        }
        if (!from && !fromUserId && contacts.length === 1) {
          const co = obj(contacts[0]);
          if (!from) from = str(co.wa_id);
          if (!fromUserId) fromUserId = str(co.user_id);
        }
        if (!from && !fromUserId) continue;

        const parsed = parseMessage(m);
        if (!parsed) continue;

        if (isDuplicate(parsed.waMessageId)) {
          log.debug(`Mensagem duplicada ignorada: ${parsed.waMessageId}`);
          continue;
        }

        // Reação inbound: atualiza JSON `reactions` do Message alvo em
        // vez de criar uma Message nova. O alvo é identificado pelo wamid
        // (externalId). Se não existir localmente (raro), apenas ignora.
        if (parsed.reactionTarget) {
          try {
            await applyIncomingReaction({
              targetWaMessageId: parsed.reactionTarget.targetWaMessageId,
              emoji: parsed.reactionTarget.emoji,
              fromWaId: from || fromUserId || "",
              at: parsed.timestamp,
            });
          } catch (err) {
            log.warn(
              `Falha ao aplicar reação (wamid=${parsed.reactionTarget.targetWaMessageId}): ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
          continue;
        }

        try {
          const profileName =
            (from && contactMap.get(from)) ||
            (fromUserId && contactMap.get(fromUserId)) ||
            null;
          const profileUsername =
            (from && usernameMap.get(from)) ||
            (fromUserId && usernameMap.get(fromUserId)) ||
            null;

          // Tratamento especial para mensagens de sistema "user_changed_number":
          // o payload vem com o NOVO wa_id/BSUID, e se o contato antigo não
          // tinha BSUID salvo (ou o Meta trocou user_id entre os eventos),
          // a resolução padrão criaria um LEAD NOVO e dispararia automações
          // de boas-vindas. Aqui tentamos localizar o contato ANTIGO pelo
          // `oldPhone` extraído do body ("FROM x TO y"); se acharmos, usamos
          // ele. Se não, pulamos a mensagem em vez de criar lead espúrio.
          let contact: CrmContact | null = null;
          const sysEvent =
            msgType === "system" ? extractSystemEvent(m) : null;
          const isPhoneChangeEvent = sysEvent?.kind === "user_changed_number";
          if (sysEvent?.kind === "user_changed_number") {
            const oldDigits = (sysEvent.oldPhone ?? "").replace(/\D/g, "");
            if (oldDigits.length >= 10) {
              const normalizedOld = normalizePhone(oldDigits);
              const byOld = await prisma.contact.findFirst({
                where: { phone: normalizedOld },
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  whatsappBsuid: true,
                  whatsappUsername: true,
                },
              });
              if (byOld) {
                contact = {
                  id: byOld.id,
                  name: byOld.name,
                  phone: byOld.phone ?? null,
                  whatsappBsuid: byOld.whatsappBsuid ?? null,
                  whatsappUsername: byOld.whatsappUsername ?? null,
                };
                log.info(
                  `Troca de número: contato antigo ${byOld.id} localizado pelo oldPhone ${normalizedOld} → novo ${sysEvent.newPhone ?? "?"}`,
                );
              }
            }
            if (!contact) {
              // Fallback: tenta BSUID/novo telefone, mas SEM criar lead.
              contact = await resolveWebhookContact(
                from || undefined,
                fromUserId || undefined,
                profileName,
                phoneNumberId || undefined,
                { createIfMissing: false, username: profileUsername },
              );
            }
            if (!contact) {
              log.warn(
                `Ignorando system user_changed_number: não foi possível localizar contato antigo (old=${sysEvent.oldPhone ?? "?"} new=${sysEvent.newPhone ?? "?"} bsuid=${fromUserId || "?"})`,
              );
              continue;
            }
          }

          if (!contact) {
            contact = await resolveWebhookContact(
              from || undefined,
              fromUserId || undefined,
              profileName,
              phoneNumberId || undefined,
              { username: profileUsername },
            );
          }
          // Evita warning de variável unused quando o fluxo principal
          // não precisa do flag (consumidores futuros podem usar).
          void isPhoneChangeEvent;
          try {
            // Tracking de anúncios: salva referral na primeira mensagem do contato
            // (ctwa_clid é único por clique — não sobrescreve se já preenchido)
            if (parsed.referral) {
              const ref = parsed.referral;
              const fullContact = await prisma.contact.findUnique({
                where: { id: contact.id },
                select: { adSourceId: true, adCtwaClid: true, adHeadline: true, source: true },
              });
              const needsUpdate =
                (ref.sourceId && !fullContact?.adSourceId) ||
                (ref.ctwaClid && !fullContact?.adCtwaClid);
              if (needsUpdate) {
                await prisma.contact.update({
                  where: { id: contact.id },
                  data: {
                    ...(ref.sourceId && !fullContact?.adSourceId
                      ? { adSourceId: ref.sourceId, adSourceType: ref.sourceType }
                      : {}),
                    ...(ref.ctwaClid && !fullContact?.adCtwaClid
                      ? { adCtwaClid: ref.ctwaClid }
                      : {}),
                    ...(ref.headline && !fullContact?.adHeadline
                      ? { adHeadline: ref.headline }
                      : {}),
                    ...(ref.headline &&
                    (!fullContact?.source || fullContact.source === "WhatsApp")
                      ? { source: `Anúncio: ${ref.headline.slice(0, 100)}` }
                      : {}),
                  },
                });
                log.info(
                  `Referral de anúncio salvo — contato=${contact.id} adId=${ref.sourceId ?? "—"} ctwa=${ref.ctwaClid ?? "—"} headline="${ref.headline ?? "—"}"`,
                );
              }

              // Resolução do ad_id real via Marketing API quando o referral
              // veio como post promovido. Roda em background (fire-and-forget)
              // pra não atrasar o 200 OK pra Meta. Resultados são gravados
              // nos campos `ad_resolved_*` do contato.
              if (ref.sourceId) {
                if (ref.sourceType === "ad") {
                  // source_type=ad já traz o ad_id no source_id — copia direto.
                  void prisma.contact
                    .update({
                      where: { id: contact.id },
                      data: {
                        adResolvedId: ref.sourceId,
                        adResolvedAt: new Date(),
                        adResolveStatus: "ok",
                        adResolveError: null,
                      },
                    })
                    .catch((e) =>
                      log.debug(
                        "falha ao copiar adResolvedId direto (não-fatal):",
                        e,
                      ),
                    );
                } else if (ref.sourceType === "post") {
                  // Post promovido — precisa chamar Graph API pra mapear post→ad.
                  const orgId = getOrgIdOrNull();
                  if (orgId) {
                    const token = await resolveAccessToken(
                      phoneNumberId || undefined,
                    );
                    void resolveAdAndPersistAsync({
                      contactId: contact.id,
                      organizationId: orgId,
                      sourceId: ref.sourceId,
                      accessToken: token,
                    });
                  }
                }
              }
            }
          } catch (err) {
            log.warn("Falha ao salvar referral de anúncio (não-fatal):", err);
          }
          const conversation = await findOrCreateConversation(contact.id, phoneNumberId || undefined);

          let mediaUrl = parsed.mediaUrl;
          if (!mediaUrl && parsed.mediaId) {
            // PR 1.3: passamos organizationId para storage tenant-scoped.
            mediaUrl = await downloadAndSaveMedia(
              parsed.mediaId,
              parsed.mimeType,
              conversation.organizationId,
              phoneNumberId || undefined,
            );
          }

          const isSystemMessage = parsed.type === "system";

          const inboundMsgType =
            isSystemMessage
              ? "system"
              : parsed.mediaId
                ? parsed.type
                : parsed.type === "interactive" || parsed.type === "button"
                  ? "interactive"
                  : "text";

          // Resolve o alvo da citação (reply) ANTES da transação — evita
          // manter a tx aberta pra query custosa e permite fallback silencioso
          // quando o alvo não existe no CRM (ex.: cliente respondeu uma
          // mensagem enviada por outro canal ou anterior à integração).
          const replyLink = parsed.replyToWaMessageId
            ? await resolveReplyContext(parsed.replyToWaMessageId)
            : null;

          const msgCreated = await prisma.$transaction(async (tx) => {
              const existing = await tx.message.findFirst({
              where: { externalId: parsed.waMessageId },
              select: { id: true },
            });
            if (existing) return null;

            return tx.message.create({
              data: withOrgFromCtx({
                conversationId: conversation.id,
                channelId: conversation.channelId ?? undefined,
                content: parsed.text,
                direction: isSystemMessage ? "system" : "in",
                messageType: inboundMsgType,
                externalId: parsed.waMessageId,
                senderName: isSystemMessage ? "WhatsApp" : (profileName || contact.name),
                mediaUrl,
                createdAt: parsed.timestamp,
                ...(replyLink
                  ? {
                      replyToId: replyLink.messageId,
                      replyToPreview: replyLink.preview,
                    }
                  : {}),
              }),
            });
          });

          if (!msgCreated) continue;

          // Activity Log: registra MESSAGE_RECEIVED no feed unificado.
          // Mensagens "system" do WhatsApp (ex.: user_changed_number)
          // tambem entram para auditoria — actor INTEGRATION nos dois
          // casos (no system, sublabel reflete a origem).
          if (!isSystemMessage) {
            void (async () => {
              const openDeal = await prisma.deal.findFirst({
                where: { contactId: contact.id, status: "OPEN" },
                select: { id: true },
                orderBy: { updatedAt: "desc" },
              }).catch(() => null);
              await logEvent({
                type: "MESSAGE_RECEIVED",
                entityType: "MESSAGE",
                entityId: msgCreated.id,
                entityLabel: profileName || contact.name || "Mensagem recebida",
                conversationId: conversation.id,
                contactId: contact.id,
                dealId: openDeal?.id ?? null,
                actor: {
                  type: "INTEGRATION",
                  label: contact.name ?? profileName ?? "Contato",
                  sublabel: contact.phone ?? "WhatsApp",
                  ref: contact.id,
                },
                meta: {
                  preview: (parsed.text ?? "").slice(0, 200),
                  channel: "WhatsApp",
                  via: "meta_cloud_api",
                  messageType: inboundMsgType,
                  externalId: parsed.waMessageId,
                },
              });
            })();
          }

          // Campanhas: correlaciona a resposta inbound ao disparo de campanha
          // mais recente do contato (marca repliedAt + incrementa repliedCount).
          // Fire-and-forget — não bloqueia o processamento da mensagem.
          if (!isSystemMessage) {
            markCampaignReplyByContact(contact.id, parsed.timestamp ?? new Date()).catch(
              (err) =>
                log.warn("Falha ao correlacionar resposta de campanha:", err),
            );
          }

          if (parsed.flowPayload && Object.keys(parsed.flowPayload).length > 0) {
            try {
              const flowApply = await applyWhatsappFlowResponseToContact({
                contactId: contact.id,
                conversationId: conversation.id,
                organizationId: conversation.organizationId,
                flowPayload: parsed.flowPayload,
                flowMetaName: parsed.flowMetaName,
                flowToken: parsed.flowToken,
                channelRef: conversation.channelId
                  ? { id: conversation.channelId, provider: "META_CLOUD_API" }
                  : null,
                waJid: null,
              });
              if (flowApply.alerts.length > 0) {
                log.warn("[whatsapp-flow] alertas na aplicação", {
                  contactId: contact.id,
                  alerts: flowApply.alerts,
                });
              }
            } catch (err) {
              log.error("[whatsapp-flow] falha ao aplicar resposta no lead (não-fatal):", err);
            }
          }

          // Inbound do cliente cancela automaticamente qualquer mensagem
          // agendada pendente para esta conversa (cliente respondeu antes
          // do envio programado). Ignorado para mensagens de sistema.
          if (!isSystemMessage) {
            cancelPendingForConversation(conversation.id, "client_reply").catch(
              (err) =>
                log.warn("Falha ao cancelar agendamentos pendentes:", err),
            );
          }

          if (isSystemMessage) {
            await prisma.conversation.update({
              where: { id: conversation.id },
              data: { updatedAt: new Date() },
            }).catch(() => {});
            log.debug(`Mensagem de sistema WhatsApp: ${parsed.text.substring(0, 120)}`);

            // Detecta troca de número (`user_changed_number`) e: atualiza
            // o telefone do contato, grava o log auditável e dispara SSE.
            // Roda em try/catch isolado pra que falha aqui NUNCA derrube
            // a ingestão da mensagem em si.
            try {
              if (sysEvent && parsed.waMessageId) {
                await applyContactPhoneChange({
                  contactId: contact.id,
                  currentPhone: contact.phone,
                  currentBsuid: contact.whatsappBsuid,
                  currentName: contact.name,
                  event: sysEvent,
                  messageExternalId: parsed.waMessageId,
                });
              }
            } catch (err) {
              log.warn("Falha ao processar troca de número (não-fatal):", err);
            }
          } else {
            try {
              const consentPayload = {
                type: parsed.type,
                interactiveButtonId: parsed.interactiveButtonId,
                interactiveButtonTitle: parsed.interactiveButtonTitle,
                interactiveKind: parsed.interactiveKind,
                text: parsed.text,
                callPermissionType: parsed.callPermissionType,
              };
              const granted = await maybeGrantWhatsappCallConsent(
                conversation.id,
                consentPayload,
              );
              if (granted) {
                sseBus.publish("conversation_updated", {
                  organizationId: getOrgIdOrNull(),
                  conversationId: conversation.id,
                  contactId: contact.id,
                  whatsappCallConsentStatus: "GRANTED",
                });
              } else {
                // Se não virou GRANTED, pode ter sido um decline: derruba o
                // consent para DENIED (cobre "REQUESTED → DENIED" e também
                // revogação pós-aceite "GRANTED → DENIED").
                const denied = await maybeDenyWhatsappCallConsent(
                  conversation.id,
                  consentPayload,
                );
                if (denied) {
                  sseBus.publish("conversation_updated", {
                    organizationId: getOrgIdOrNull(),
                    conversationId: conversation.id,
                    contactId: contact.id,
                    whatsappCallConsentStatus: "DENIED",
                  });
                }
              }
            } catch (err) {
              log.warn("Falha ao atualizar consent de ligação (não-fatal):", err);
            }

            try {
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                  updatedAt: new Date(),
                  unreadCount: { increment: 1 },
                  lastInboundAt: parsed.timestamp ?? new Date(),
                  lastMessageDirection: "in",
                  hasError: false,
                },
              });
            } catch {
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                  updatedAt: new Date(),
                  unreadCount: { increment: 1 },
                  lastInboundAt: parsed.timestamp ?? new Date(),
                },
              }).catch(() => {});
            }

            try {
              sseBus.publish("new_message", {
                organizationId: getOrgIdOrNull(),
                conversationId: conversation.id,
                contactId: contact.id,
                direction: "in",
                content: parsed.text,
                timestamp: parsed.timestamp,
              });
            } catch (err) {
              log.debug("Falha ao publicar SSE (não-fatal):", err);
            }

            // Push notification ao operador (PWA — funciona com app
            // fechado). Disparado em background pra nao atrasar 200
            // OK do webhook (Meta tem janela de retry curta).
            notifyInboundMessage({
              conversationId: conversation.id,
              contactId: contact.id,
              contactName: contact.name,
              preview: parsed.text || "[mídia]",
              channel: "WhatsApp",
            }).catch((err) =>
              log.debug("Falha ao enviar push (não-fatal):", err),
            );

            try {
              await processSalesbotMessage(contact.id, parsed.text);
            } catch (err) {
              log.error("Falha no salesbot:", err);
            }

            try {
              await fireTrigger("message_received", {
                contactId: contact.id,
                data: {
                  channel: "WhatsApp",
                  content: parsed.text,
                  phoneNumberId,
                  conversationId: conversation.id,
                  waMessageId: parsed.waMessageId,
                  metaWebhookEventId,
                  ...(parsed.flowPayload
                    ? {
                        flowResponse: parsed.flowPayload,
                        flowMetaName: parsed.flowMetaName,
                        flowToken: parsed.flowToken,
                      }
                    : {}),
                },
              });
            } catch (err) {
              log.error("Falha ao disparar gatilho message_received:", err);
            }

            // Agente de IA atribuído à conversa? Dispara resposta
            // (autônoma ou como rascunho, conforme config). Background:
            // não atrasamos o 200 OK pra Meta (LLM pode demorar 2-6s).
            if (!isSystemMessage && parsed.text) {
              void maybeReplyAsAIAgent({
                conversationId: conversation.id,
                contactId: contact.id,
                userMessage: parsed.text,
                channel: "meta",
              });
            }

            log.info(`Mensagem de ${contact.name}: ${parsed.text.substring(0, 60)}`);
          }
        } catch (err) {
          log.error("Erro ao processar mensagem:", err);
        }
      }
    }
  }

  if (metaWebhookEventId) {
    await markWebhookEventProcessed(metaWebhookEventId, null);
  }

  return NextResponse.json({ status: "ok" });
}

// ─── Auditoria do webhook Meta ────────────────────────────────
// Captura o payload bruto + headers relevantes do POST e gera um
// MetaWebhookEvent. O ID é propagado via context.data.metaWebhookEventId
// até o `automation_logs.metaWebhookEventId`, permitindo que a UI da
// automação exiba o JSON original entregue pela Meta.

function pickWebhookHeaders(h: Headers): Record<string, string> {
  const keys = [
    "x-hub-signature-256",
    "x-forwarded-for",
    "x-real-ip",
    "user-agent",
    "content-type",
    "x-request-id",
  ];
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = h.get(k);
    if (v) out[k] = v;
  }
  return out;
}

function summarizeFirstMessage(body: Record<string, unknown>): {
  eventType: string;
  phoneNumberId: string | null;
  waMessageId: string | null;
  fromPhone: string | null;
} {
  let eventType = "unknown";
  let phoneNumberId: string | null = null;
  let waMessageId: string | null = null;
  let fromPhone: string | null = null;

  const entries = arr(body.entry);
  for (const entry of entries) {
    const e = obj(entry);
    const changes = arr(e.changes);
    for (const change of changes) {
      const ch = obj(change);
      const field = str(ch.field);
      const value = obj(ch.value);
      const metadata = obj(value.metadata);
      const pid = str(metadata.phone_number_id);
      if (pid && !phoneNumberId) phoneNumberId = pid;

      if (field === "messages") {
        const messages = arr(value.messages);
        if (messages.length > 0) {
          eventType = "message";
          const m = obj(messages[0]);
          const id = str(m.id);
          const from = str(m.from);
          if (id) waMessageId = id;
          if (from) fromPhone = from;
        } else if (arr(value.statuses).length > 0) {
          eventType = eventType === "unknown" ? "status" : eventType;
        }
      } else if (field) {
        eventType = eventType === "unknown" ? field : eventType;
      }
    }
  }

  return { eventType, phoneNumberId, waMessageId, fromPhone };
}

async function createMetaWebhookEvent(args: {
  rawBody: Record<string, unknown>;
  headers: Record<string, string>;
  signatureValid: boolean;
  scope: WebhookScope | undefined;
}): Promise<string | null> {
  const { rawBody, headers, signatureValid, scope } = args;
  const summary = summarizeFirstMessage(rawBody);

  // Resolve channelId best-effort pelo phoneNumberId.
  let channelId: string | null = null;
  let organizationId: string | null = scope?.organizationId ?? null;
  if (summary.phoneNumberId) {
    try {
      const channel = await prismaBase.channel.findFirst({
        where: {
          type: "WHATSAPP",
          provider: "META_CLOUD_API",
          config: { path: ["phoneNumberId"], equals: summary.phoneNumberId },
        },
        select: { id: true, organizationId: true },
      });
      if (channel) {
        channelId = channel.id;
        if (!organizationId) organizationId = channel.organizationId;
      }
    } catch (err) {
      log.debug("Falha ao resolver channel para webhook event (não-fatal):", err);
    }
  }

  try {
    const created = await prismaBase.metaWebhookEvent.create({
      data: {
        organizationId: organizationId ?? null,
        channelId,
        signatureValid,
        objectType: str(rawBody.object) || null,
        eventType: summary.eventType,
        phoneNumberId: summary.phoneNumberId,
        waMessageId: summary.waMessageId,
        fromPhone: summary.fromPhone,
        rawBody: rawBody as Prisma.InputJsonValue,
        headers: headers as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    log.error("Falha ao persistir MetaWebhookEvent (não-fatal):", err);
    return null;
  }
}

async function markWebhookEventProcessed(
  id: string,
  errorMessage: string | null,
): Promise<void> {
  try {
    await prismaBase.metaWebhookEvent.update({
      where: { id },
      data: {
        processed: true,
        processingError: errorMessage,
      },
    });
  } catch (err) {
    log.debug("Falha ao marcar MetaWebhookEvent como processado (não-fatal):", err);
  }
}

