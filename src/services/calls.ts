/**
 * Service: Chamadas (Call) — orquestração do pipeline de webhook.
 *
 * Fluxo do processWebhookEvent:
 *  1. Resolve CallProviderConfig pelo webhookToken (SEM contexto de org)
 *     via prismaBase — consulta sistêmica sem RLS.
 *  2. Valida autenticidade (HMAC ou TOKEN).
 *  3. Executa o restante DENTRO do contexto da org resolvida via
 *     withResolvedContext (webhook público sem sessão).
 *  4. Grava CallEvent bruto (sempre, antes de normalizar).
 *  5. Normaliza via adapter.
 *  6. Upsert idempotente do Call por (org, provider, providerCallId).
 *  7. Vincula contato; auto-cria se config.createContactsForCalls.
 *  8. Re-hospeda gravação se disponível.
 *  9. Liga CallEvent.callId ao Call.
 *
 * Retorno: { ok: false, reason: string } | { ok: true, callId, callEventId }
 * Não lança exceções para auth — retorna { ok: false, reason } para que
 * o route handler possa diferenciar 401 de 200.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { CallDirection, CallStatus, Prisma } from "@prisma/client";

import { withResolvedContext } from "@/lib/auth-helpers";
import { getLogger } from "@/lib/logger";
import { normalizePhone, phoneMatchVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/prisma-helpers";
import { sseBus } from "@/lib/sse-bus";
import { generateFileName, saveFile } from "@/lib/storage/local";
import { logEvent } from "@/services/activity-log";
import { fireTrigger } from "@/services/automation-triggers";
import { getContacts, createContact } from "@/services/contacts";
import { getAdapter } from "./call-adapters";
import { findConfigByWebhookToken, decryptWebhookSecret } from "./call-provider-configs";

const log = getLogger("calls-service");

/** Duração legível pra o aviso de chamada no chat (ex.: "2min 12s", "45s"). */
function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m <= 0) return `${sec}s`;
  return sec > 0 ? `${m}min ${sec}s` : `${m}min`;
}

// ── Tipos públicos ────────────────────────────────────────────────────────

export type ProcessWebhookInput = {
  provider: string;
  webhookToken: string;
  rawPayload: unknown;
  /** Header de assinatura HMAC (valor bruto do header). */
  signatureHeader?: string | null;
  /** Body cru — necessário para verificação HMAC. String ou Buffer. */
  rawBody?: string | Buffer | null;
};

export type ProcessWebhookResult =
  | { ok: false; reason: string }
  | { ok: true; callId: string; callEventId: string };

export type ListCallsFilters = {
  extensionId?: string;
  direction?: CallDirection;
  contactId?: string;
  status?: CallStatus;
  /** Busca livre por nome do contato ou dígitos do telefone. */
  search?: string;
  /** Data inicial (YYYY-MM-DD, inclusiva) sobre startedAt/createdAt. */
  dateFrom?: string;
  /** Data final (YYYY-MM-DD, inclusiva) sobre startedAt/createdAt. */
  dateTo?: string;
  page?: number;
  perPage?: number;
};

export type UpdateCallInput = {
  status?: CallStatus;
  recordingUrl?: string | null;
};

// ── HMAC helpers ──────────────────────────────────────────────────────────

/**
 * Verifica assinatura HMAC-SHA256.
 * Usa timingSafeEqual para evitar timing attacks.
 * Suporta formato "sha256=<hex>" (padrão GitHub/Asterisk/Twilio) e "<hex>" direto.
 */
function verifyHmac(
  rawBody: string | Buffer,
  secret: string,
  signatureRaw: string,
): boolean {
  try {
    const sig = signatureRaw.replace(/^sha256=/i, "").toLowerCase();
    const bodyBuf = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
    const expected = createHmac("sha256", secret).update(bodyBuf).digest("hex");
    const a = Buffer.from(sig.padEnd(expected.length, "0"), "hex");
    const b = Buffer.from(expected, "hex");
    // Evita side-channel se comprimentos diferentes
    if (a.length !== b.length) {
      // Compara de tamanho fixo com buffer descartável para não vazar timing
      timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── Vínculo a contato ─────────────────────────────────────────────────────

async function resolveContactId(
  phone: string,
  createIfMissing: boolean,
): Promise<string | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const result = await getContacts({ phoneExact: normalized, perPage: 1 });
  if (result.items && result.items.length > 0) {
    return result.items[0].id;
  }

  if (!createIfMissing) return null;

  try {
    const contact = await createContact({
      name: normalized,
      phone: normalized,
      source: "softphone",
    });
    return contact.id;
  } catch (err) {
    log.warn({ err }, "[calls] falha ao criar contato automático — continuando sem vínculo");
    return null;
  }
}

// ── Re-hospedagem de gravação ──────────────────────────────────────────────

async function reHostRecording(
  orgId: string,
  callId: string,
  providerUrl: string,
): Promise<string | null> {
  try {
    const response = await fetch(providerUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      log.warn({ status: response.status, providerUrl }, "[calls] falha ao baixar gravação");
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = providerUrl.split(".").pop()?.split("?")[0]?.toLowerCase() ?? "wav";
    const fileName = generateFileName({ prefix: `call_${callId}`, ext });
    const { url } = await saveFile({ orgId, bucket: "recordings", fileName, buffer });
    return url;
  } catch (err) {
    log.warn({ err, providerUrl }, "[calls] erro ao re-hospedar gravação — marcando pendente");
    return null;
  }
}

// ── Pipeline principal ────────────────────────────────────────────────────

/**
 * Processa um evento de webhook de chamada.
 *
 * Multi-tenant (webhook público sem sessão):
 *  1. Busca CallProviderConfig pelo webhookToken via prismaBase (sem RLS).
 *     Decisão de implementação: consulta sistêmica usando prismaBase
 *     (sem extension de tenant) porque o organizationId ainda não é
 *     conhecido neste ponto — é o próprio webhookToken que o revela.
 *  2. Valida autenticidade ANTES de processar. Retorna { ok: false }
 *     em vez de lançar exceção para que o route possa responder 401.
 *  3. Usa withResolvedContext({ organizationId, userId: "SYSTEM" }) —
 *     helper de auth-helpers.ts para código fora de sessão HTTP (webhooks,
 *     cron, consumers de fila). Garante que prisma.* scoped tenham o
 *     RequestContext correto sem exigir sessão NextAuth.
 */
export async function processWebhookEvent(
  input: ProcessWebhookInput,
): Promise<ProcessWebhookResult> {
  // ── 1. Resolver config pelo token (sem contexto de org) ──────────────
  const config = await findConfigByWebhookToken(input.webhookToken);

  if (!config) {
    return { ok: false, reason: "token_not_found_or_inactive" };
  }

  if (!config.isActive) {
    return { ok: false, reason: "token_not_found_or_inactive" };
  }

  // ── 2. Validar autenticidade ──────────────────────────────────────────
  if (config.authMode === "HMAC") {
    const signatureHeader = input.signatureHeader ?? "";
    if (!signatureHeader || !input.rawBody) {
      return { ok: false, reason: "hmac_signature_missing" };
    }
    const secret = decryptWebhookSecret(config);
    if (!verifyHmac(input.rawBody, secret, signatureHeader)) {
      return { ok: false, reason: "hmac_invalid" };
    }
  }
  // TOKEN mode: a presença do webhookToken único na URL já é suficiente
  // (validado implicitamente por findConfigByWebhookToken acima).

  const organizationId = config.organizationId;

  // ── 3. Executar processamento em contexto da org resolvida ────────────
  // withResolvedContext é o helper canônico do repo para webhooks/cron.
  // userId: "SYSTEM" é o sentinel para eventos não-humanos; o actor.type
  // "INTEGRATION" garante que o activity log atribua corretamente.
  try {
    return await withResolvedContext(
      {
        organizationId,
        userId: "SYSTEM",
        isSuperAdmin: false,
        actor: { type: "INTEGRATION", label: `webhook:${config.providerKey}` },
      },
      async () => {
        // ── 4. Gravar CallEvent bruto (sempre, antes de normalizar) ─────
        const callEvent = await prisma.callEvent.create({
          data: withOrg(
            {
              provider: input.provider,
              rawPayload: input.rawPayload as Record<string, unknown>,
              receivedAt: new Date(),
            },
            organizationId,
          ),
          select: { id: true },
        });

        // ── 5. Normalizar via adapter ──────────────────────────────────
        const adapter = getAdapter(config.providerKey);
        const normalized = adapter.normalize(
          input.rawPayload,
          config as Parameters<typeof adapter.normalize>[1],
        );

        // ── 6. Upsert idempotente do Call ──────────────────────────────
        const fromNormalized = normalizePhone(normalized.from) ?? normalized.from;
        const toNormalized = normalizePhone(normalized.to) ?? normalized.to;

        const existingCall = await prisma.call.findUnique({
          where: {
            organizationId_provider_providerCallId: {
              organizationId,
              provider: input.provider,
              providerCallId: normalized.providerCallId,
            },
          },
          select: {
            id: true,
            answeredAt: true,
            endedAt: true,
            contactId: true,
            recordingUrl: true,
          },
        });

        const eventTime = new Date(normalized.timestamp);

        const answeredAt =
          normalized.status === "ANSWERED" ? eventTime : undefined;
        const endedAt =
          normalized.status === "COMPLETED" ||
          normalized.status === "FAILED" ||
          normalized.status === "MISSED" ||
          normalized.status === "BUSY"
            ? eventTime
            : undefined;

        const resolvedAnsweredAt = answeredAt ?? existingCall?.answeredAt ?? undefined;
        const resolvedEndedAt = endedAt ?? existingCall?.endedAt ?? undefined;
        // Preferência: duration do provedor (Api4com no channel-hangup);
        // fallback: cálculo answered → ended.
        const durationSeconds =
          normalized.durationSeconds ??
          (resolvedAnsweredAt && resolvedEndedAt
            ? Math.max(
                0,
                Math.round(
                  (resolvedEndedAt.getTime() - resolvedAnsweredAt.getTime()) / 1000,
                ),
              )
            : undefined);

        // Metadata CRM ecoada pelo /dialer — usada para vincular contato e
        // emitir ActivityEvent na timeline do deal.
        const crmMetadata = normalized.crmMetadata ?? {};

        // Resolve dealId/extensionId da metadata (validando org) uma única
        // vez — reusado no upsert do Call, no ActivityEvent e no gatilho.
        let resolvedDealId: string | null = null;
        if (crmMetadata.dealId) {
          const d = await prisma.deal.findUnique({
            where: { id: crmMetadata.dealId },
            select: { id: true, organizationId: true },
          });
          if (d && d.organizationId === organizationId) resolvedDealId = d.id;
        }
        let resolvedExtensionId: string | null = null;
        if (crmMetadata.crmUserId) {
          const ext = await prisma.sipExtension.findFirst({
            where: { userId: crmMetadata.crmUserId },
            select: { id: true },
          });
          if (ext) resolvedExtensionId = ext.id;
        }

        let call: { id: string; contactId: string | null; recordingUrl: string | null };

        if (existingCall) {
          // Idempotência: só atualiza campos de ciclo de vida
          call = await prisma.call.update({
            where: { id: existingCall.id },
            data: {
              status: normalized.status as CallStatus,
              ...(answeredAt ? { answeredAt } : {}),
              ...(endedAt ? { endedAt } : {}),
              ...(durationSeconds !== undefined ? { durationSeconds } : {}),
              ...(resolvedDealId ? { dealId: resolvedDealId } : {}),
              ...(resolvedExtensionId ? { extensionId: resolvedExtensionId } : {}),
            },
            select: { id: true, contactId: true, recordingUrl: true },
          });
        } else {
          call = await prisma.call.create({
            data: withOrg(
              {
                direction: normalized.direction as CallDirection,
                status: normalized.status as CallStatus,
                fromNumber: fromNormalized,
                toNumber: toNormalized,
                provider: input.provider,
                providerCallId: normalized.providerCallId,
                startedAt: normalized.status === "RINGING" ? eventTime : undefined,
                answeredAt,
                endedAt,
                durationSeconds,
                ...(resolvedDealId ? { dealId: resolvedDealId } : {}),
                ...(resolvedExtensionId ? { extensionId: resolvedExtensionId } : {}),
                metadata: crmMetadata as unknown as Prisma.InputJsonValue,
              },
              organizationId,
            ),
            select: { id: true, contactId: true, recordingUrl: true },
          });
        }

        // ── 7. Vincular contato ────────────────────────────────────────
        // Preferência: contactId vindo da metadata CRM (origem confiável,
        // foi o próprio CRM que disparou o /dialer com essa correlação).
        // Fallback: match por telefone + auto-create se configurado.
        if (!call.contactId) {
          let contactId: string | null = null;

          if (crmMetadata.contactId) {
            const exists = await prisma.contact.findUnique({
              where: { id: crmMetadata.contactId },
              select: { id: true },
            });
            if (exists) contactId = exists.id;
          }

          if (!contactId) {
            const phoneToMatch =
              normalized.direction === "INBOUND" ? fromNormalized : toNormalized;
            contactId = await resolveContactId(
              phoneToMatch,
              config.createContactsForCalls,
            );
          }

          if (contactId) {
            await prisma.call.update({
              where: { id: call.id },
              data: { contactId },
            });
            call = { ...call, contactId };
          }
        }

        // ── 8. Re-hospedar gravação ────────────────────────────────────
        if (normalized.recordingUrl && !call.recordingUrl) {
          if (config.recordingDelivery === "URL") {
            const hosted = await reHostRecording(
              organizationId,
              call.id,
              normalized.recordingUrl,
            );
            if (hosted) {
              await prisma.call.update({
                where: { id: call.id },
                data: { recordingUrl: hosted },
              });
            }
          } else if (
            config.recordingDelivery === "FETCH_LATER" ||
            config.recordingDelivery === "INLINE"
          ) {
            // Persiste URL original para busca posterior / inline gravado no CallEvent
            await prisma.call.update({
              where: { id: call.id },
              data: { recordingUrl: normalized.recordingUrl },
            });
          }
        }

        // ── 9. Ligar CallEvent.callId ao Call ─────────────────────────
        await prisma.callEvent.update({
          where: { id: callEvent.id },
          data: { callId: call.id },
        });

        // ── 10. Emitir ActivityEvent na timeline do deal ───────────────
        // Só no evento terminal (hangup) e quando há dealId na metadata —
        // evita duplicar entrada na timeline a cada channel-answer.
        const isTerminal =
          normalized.eventKind === "HANGUP" ||
          normalized.status === "COMPLETED" ||
          normalized.status === "MISSED" ||
          normalized.status === "BUSY" ||
          normalized.status === "FAILED";

        // Guard de idempotência: só registra no primeiro evento terminal.
        // Se o provedor reenviar o hangup, `existingCall.endedAt` já estará
        // setado e evitamos duplicar log/timeline/aviso no chat.
        const firstTerminal = isTerminal && !existingCall?.endedAt;

        if (firstTerminal) {
          const isInbound = normalized.direction === "INBOUND";
          const answered =
            Boolean(resolvedAnsweredAt) || (durationSeconds ?? 0) > 0;
          const eventType = answered ? "CALL_COMPLETED" : "CALL_MISSED";
          const contactIdForLog = call.contactId ?? crmMetadata.contactId ?? null;
          const durationSec = durationSeconds ?? null;

          // Conversa mais recente do contato — dá conversationId pro log e
          // hospeda o aviso no chat. Decisão de produto: NÃO criar conversa
          // nova só pra isso; sem conversa, fica só log + timeline.
          let conversationId: string | null = null;
          if (contactIdForLog) {
            const conv = await prisma.conversation.findFirst({
              where: { contactId: contactIdForLog },
              orderBy: { updatedAt: "desc" },
              select: { id: true },
            });
            conversationId = conv?.id ?? null;
          }

          const dealForLog = resolvedDealId
            ? await prisma.deal.findUnique({
                where: { id: resolvedDealId },
                select: { id: true, title: true },
              })
            : null;

          // ── 10a. Log de atividade / timeline (sempre que terminal) ─────
          // Escopo DEAL quando há negócio; senão CONTACT. `meta` alinhada ao
          // que o event-config do frontend espera (initiatedBy, durationSec)
          // + chaves cruas pra debugging.
          if (dealForLog || contactIdForLog) {
            await logEvent({
              type: eventType,
              entityType: dealForLog ? "DEAL" : "CONTACT",
              entityId: dealForLog?.id ?? contactIdForLog ?? call.id,
              entityLabel: dealForLog?.title ?? null,
              dealId: dealForLog?.id ?? null,
              contactId: contactIdForLog,
              conversationId,
              meta: {
                callId: call.id,
                provider: input.provider,
                direction: normalized.direction,
                initiatedBy: isInbound ? "contact" : "company",
                durationSec,
                durationSeconds: durationSec,
                answered,
                hangupCause: normalized.hangupCause ?? null,
                from: fromNormalized,
                to: toNormalized,
              },
            }).catch((err) =>
              log.warn({ err }, "[calls] logEvent de ligação falhou — ignorando"),
            );
          }

          // ── 10b. Aviso no chat (se houver conversa) ────────────────────
          if (conversationId) {
            const callMessageDirection: "in" | "out" = isInbound ? "in" : "out";
            const label = isInbound ? "Ligação recebida" : "Ligação realizada";
            const suffix = answered
              ? durationSec && durationSec > 0
                ? ` · ${formatCallDuration(durationSec)}`
                : ""
              : " · não atendida";
            const chatLine = `${label}${suffix}`;
            const dedupeKey = `sip_call:${call.id}`;
            const already = await prisma.message.findFirst({
              where: { conversationId, externalId: dedupeKey },
              select: { id: true },
            });
            if (!already) {
              const eventNow = new Date();
              await prisma.message.create({
                data: withOrg(
                  {
                    conversationId,
                    content: chatLine,
                    direction: callMessageDirection,
                    messageType: "sip_call",
                    senderName: "Telefonia",
                    externalId: dedupeKey,
                    sendStatus: "delivered",
                  },
                  organizationId,
                ),
              });
              await prisma.conversation
                .update({
                  where: { id: conversationId },
                  data: {
                    updatedAt: eventNow,
                    lastMessageDirection: callMessageDirection,
                  },
                })
                .catch(() => {});
              sseBus.publish("new_message", {
                organizationId,
                conversationId,
                contactId: contactIdForLog ?? undefined,
                direction: callMessageDirection,
                content: chatLine,
                timestamp: eventNow,
              });
            }
          }
        }

        // ── 11. Disparar automações de ligação (call_received/call_made) ──
        // Só no evento terminal (hangup) pra não disparar a cada
        // channel-answer/ringing. Vale mesmo sem deal — uma automação de
        // "ligação recebida" pode rodar só com o contato.
        if (isTerminal) {
          const answered =
            Boolean(resolvedAnsweredAt) || (durationSeconds ?? 0) > 0;
          const event =
            normalized.direction === "INBOUND" ? "call_received" : "call_made";
          await fireTrigger(event, {
            contactId: call.contactId ?? crmMetadata.contactId ?? undefined,
            dealId: resolvedDealId ?? undefined,
            data: {
              callId: call.id,
              provider: input.provider,
              direction: normalized.direction,
              status: normalized.status,
              answered,
              durationSeconds: durationSeconds ?? null,
              from: fromNormalized,
              to: toNormalized,
              crmUserId: crmMetadata.crmUserId ?? null,
            },
          }).catch((err) => {
            log.warn({ err }, "[calls] fireTrigger de ligação falhou — ignorando");
          });
        }

        return { ok: true as const, callId: call.id, callEventId: callEvent.id };
      },
    );
  } catch (err) {
    log.error({ err }, "[calls] erro ao processar evento de chamada");
    return { ok: false, reason: "processing_error" };
  }
}

// ── Listagem e detalhe ───────────────────────────────────────────────────

export async function listCalls(filters: ListCallsFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20));
  const where: Prisma.CallWhereInput = {};

  if (filters.extensionId) where.extensionId = filters.extensionId;
  if (filters.direction) where.direction = filters.direction;
  if (filters.contactId) where.contactId = filters.contactId;
  if (filters.status) where.status = filters.status;

  const and: Prisma.CallWhereInput[] = [];

  // Período (inclusivo) sobre startedAt, com fallback em createdAt quando
  // a chamada ainda não tem startedAt registrado.
  const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`) : null;
  const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`) : null;
  if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
    const range: Prisma.DateTimeFilter = {};
    if (from && !Number.isNaN(from.getTime())) range.gte = from;
    if (to && !Number.isNaN(to.getTime())) range.lte = to;
    and.push({
      OR: [{ startedAt: range }, { startedAt: null, createdAt: range }],
    });
  }

  // Busca livre: nome do contato vinculado OU dígitos nos números.
  const search = filters.search?.trim();
  if (search) {
    const or: Prisma.CallWhereInput[] = [
      { contact: { is: { name: { contains: search, mode: "insensitive" } } } },
    ];
    const digits = search.replace(/\D/g, "");
    if (digits) {
      or.push(
        { fromNumber: { contains: digits } },
        { toNumber: { contains: digits } },
      );
    }
    and.push({ OR: or });
  }

  if (and.length) where.AND = and;

  const [calls, total] = await Promise.all([
    prisma.call.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        extension: { select: { id: true, label: true, sipUri: true } },
      },
    }),
    prisma.call.count({ where }),
  ]);

  // Fallback: chamadas sem contactId gravado — tenta resolver o contato
  // pelo telefone normalizado (variantes com/sem 9º dígito) dentro da org.
  const unresolved = calls.filter((c) => !c.contact);
  if (unresolved.length) {
    const variantsByCall = new Map<string, string[]>();
    const allVariants = new Set<string>();
    for (const c of unresolved) {
      const phone = c.direction === "INBOUND" ? c.fromNumber : c.toNumber;
      const variants = phoneMatchVariants(phone);
      if (variants.length) {
        variantsByCall.set(c.id, variants);
        for (const v of variants) allVariants.add(v);
      }
    }
    if (allVariants.size) {
      const contacts = await prisma.contact.findMany({
        where: { phone: { in: [...allVariants] } },
        select: { id: true, name: true, phone: true },
      });
      const byPhone = new Map(contacts.map((ct) => [ct.phone, ct]));
      for (const c of unresolved) {
        const variants = variantsByCall.get(c.id);
        if (!variants) continue;
        for (const v of variants) {
          const match = byPhone.get(v);
          if (match) {
            c.contact = match;
            break;
          }
        }
      }
    }
  }

  return { calls, total, page, perPage };
}

export async function getCall(id: string) {
  return prisma.call.findUnique({
    where: { id },
    include: {
      contact: { select: { id: true, name: true, phone: true, email: true } },
      extension: { select: { id: true, label: true, sipUri: true, userId: true } },
      events: {
        select: { id: true, provider: true, rawPayload: true, receivedAt: true },
        orderBy: { receivedAt: "asc" },
      },
    },
  });
}

export async function updateCall(id: string, patch: UpdateCallInput) {
  return prisma.call.update({
    where: { id },
    data: {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.recordingUrl !== undefined ? { recordingUrl: patch.recordingUrl } : {}),
    },
  });
}
