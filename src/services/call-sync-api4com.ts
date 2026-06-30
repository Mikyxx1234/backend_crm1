/**
 * Sync/reconciliação de chamadas via Api4com `GET /calls` (CDR).
 *
 * Por quê: o registro em `/calls` dependia 100% do webhook
 * (`channel-answer`/`channel-hangup`). Quando o webhook não está
 * configurado/alcançável (gateway divergente, APP_URL ausente, etc.), as
 * chamadas funcionam mas NUNCA são gravadas. Aqui puxamos o CDR oficial da
 * Api4com e fazemos upsert idempotente em `Call`, garantindo o histórico
 * mesmo sem webhook.
 *
 * Filtramos por `metadata.gateway` (o mesmo enviado no /dialer) pra trazer
 * apenas as chamadas originadas por ESTE CRM/ org — não poluímos com o
 * histórico inteiro da conta Api4com.
 *
 * Importante: o sync NÃO dispara automações (call_received/call_made). Isso
 * é responsabilidade do webhook (tempo real); disparar aqui faria a primeira
 * sincronização "explodir" automações pra chamadas antigas.
 *
 * Ref CDR: https://developers.api4com.com/operations/Call.find__get_calls.html
 */
import type { CallDirection, CallStatus, Prisma } from "@prisma/client";

import { getLogger } from "@/lib/logger";
import { normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { withOrg } from "@/lib/prisma-helpers";
import { getContacts } from "@/services/contacts";
import { resolveApi4ComDialToken } from "@/services/sip-extensions";
import { resolveApi4ComGateway } from "@/services/telephony-providers/api4com";

const log = getLogger("calls-sync-api4com");

const API4COM_BASE = "https://api.api4com.com/api/v1";
const PROVIDER_KEY = "api4com";

type Api4ComCallRow = {
  id?: string | number;
  call_type?: string;
  started_at?: string;
  ended_at?: string;
  from?: string;
  to?: string;
  duration?: number | string;
  hangup_cause?: string;
  record_url?: string;
  metadata?: Record<string, unknown> | null;
};

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Direção a partir do call_type; chamadas do /dialer (com gateway) são saída. */
function mapDirection(callType?: string): CallDirection {
  const t = (callType ?? "").toLowerCase();
  if (t.includes("in")) return "INBOUND";
  return "OUTBOUND";
}

/** Mapeia hangup_cause (FreeSWITCH) + duração para o nosso CallStatus. */
function mapStatus(row: Api4ComCallRow): CallStatus {
  const cause = (row.hangup_cause ?? "").toUpperCase();
  const dur = Number(row.duration ?? 0);
  if (!row.ended_at && !cause) return "RINGING";
  if (dur > 0 || cause === "NORMAL_CLEARING") return "COMPLETED";
  if (cause === "USER_BUSY") return "BUSY";
  if (cause === "UNALLOCATED_NUMBER" || cause === "NUMBER_CHANGED") return "FAILED";
  // ORIGINATOR_CANCEL, ALLOTTED_TIMEOUT e afins: não atendida.
  return "MISSED";
}

function parseDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function fetchCallsPage(
  token: string,
  page: number,
): Promise<Api4ComCallRow[]> {
  const filter = JSON.stringify({ order: ["started_at DESC"], limit: 100 });
  const url = `${API4COM_BASE}/calls?page=${page}&filter=${encodeURIComponent(filter)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json", Authorization: token },
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn({ status: res.status, page }, "[calls-sync] GET /calls retornou erro");
      return [];
    }
    const data = await res.json();
    if (Array.isArray(data)) return data as Api4ComCallRow[];
    if (data && Array.isArray((data as { data?: unknown }).data)) {
      return (data as { data: Api4ComCallRow[] }).data;
    }
    return [];
  } catch (err) {
    log.warn({ err, page }, "[calls-sync] falha ao buscar página de chamadas");
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sincroniza as chamadas recentes da conta Api4com do usuário para o CRM.
 * Deve ser chamado DENTRO de um contexto de org (rota com sessão) — usa o
 * prisma contextual e `resolveApi4ComDialToken` (que lê a org do contexto).
 */
export async function syncApi4ComCalls(
  userId: string,
  opts: { maxPages?: number } = {},
): Promise<{ ok: boolean; created: number; updated: number; reason?: string }> {
  const maxPages = Math.min(5, Math.max(1, opts.maxPages ?? 2));

  const dialAuth = await resolveApi4ComDialToken(userId);
  if (!dialAuth) {
    return { ok: false, created: 0, updated: 0, reason: "no_api4com_token" };
  }

  const { apiToken, organizationId } = dialAuth;
  const gateway = resolveApi4ComGateway(organizationId);

  let created = 0;
  let updated = 0;

  for (let page = 1; page <= maxPages; page++) {
    const rows = await fetchCallsPage(apiToken, page);
    if (rows.length === 0) break;

    for (const row of rows) {
      const providerCallId = asString(String(row.id ?? ""));
      if (!providerCallId) continue;

      // Só chamadas originadas por este CRM/org (tagueadas com nosso gateway).
      const rowGateway = asString(row.metadata?.gateway as string | undefined);
      if (!rowGateway || rowGateway !== gateway) continue;

      const fromNumber = normalizePhone(row.from ?? "") ?? String(row.from ?? "");
      const toNumber = normalizePhone(row.to ?? "") ?? String(row.to ?? "");
      const direction = mapDirection(row.call_type);
      const status = mapStatus(row);
      const startedAt = parseDate(row.started_at);
      const endedAt = parseDate(row.ended_at);
      const durationSeconds =
        row.duration != null && Number.isFinite(Number(row.duration))
          ? Number(row.duration)
          : undefined;
      const recordingUrl = asString(row.record_url);

      const metaDealId = asString(
        (row.metadata?.deal_id ?? row.metadata?.dealId) as string | undefined,
      );
      const metaContactId = asString(
        (row.metadata?.contact_id ?? row.metadata?.contactId) as string | undefined,
      );

      // Resolve dealId (validando org).
      let resolvedDealId: string | null = null;
      if (metaDealId) {
        const d = await prisma.deal.findUnique({
          where: { id: metaDealId },
          select: { id: true, organizationId: true },
        });
        if (d && d.organizationId === organizationId) resolvedDealId = d.id;
      }

      // Resolve contactId: metadata > match por telefone (sem auto-criar).
      let resolvedContactId: string | null = null;
      if (metaContactId) {
        const c = await prisma.contact.findUnique({
          where: { id: metaContactId },
          select: { id: true, organizationId: true },
        });
        if (c && c.organizationId === organizationId) resolvedContactId = c.id;
      }
      if (!resolvedContactId) {
        const phoneToMatch = direction === "INBOUND" ? fromNumber : toNumber;
        const normalized = normalizePhone(phoneToMatch);
        if (normalized) {
          const match = await getContacts({ phoneExact: normalized, perPage: 1 });
          if (match.items && match.items.length > 0) {
            resolvedContactId = match.items[0].id;
          }
        }
      }

      const existing = await prisma.call.findUnique({
        where: {
          organizationId_provider_providerCallId: {
            organizationId,
            provider: PROVIDER_KEY,
            providerCallId,
          },
        },
        select: { id: true },
      });

      if (existing) {
        await prisma.call.update({
          where: { id: existing.id },
          data: {
            status,
            ...(startedAt ? { startedAt } : {}),
            ...(endedAt ? { endedAt, answeredAt: startedAt ?? undefined } : {}),
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
            ...(recordingUrl ? { recordingUrl } : {}),
            ...(resolvedDealId ? { dealId: resolvedDealId } : {}),
            ...(resolvedContactId ? { contactId: resolvedContactId } : {}),
          },
        });
        updated++;
      } else {
        await prisma.call.create({
          data: withOrg(
            {
              direction,
              status,
              fromNumber,
              toNumber,
              provider: PROVIDER_KEY,
              providerCallId,
              startedAt,
              answeredAt: durationSeconds && durationSeconds > 0 ? startedAt : undefined,
              endedAt,
              durationSeconds,
              recordingUrl: recordingUrl ?? undefined,
              dealId: resolvedDealId ?? undefined,
              contactId: resolvedContactId ?? undefined,
              metadata: (row.metadata ?? {}) as unknown as Prisma.InputJsonValue,
            },
            organizationId,
          ),
        });
        created++;
      }
    }

    if (rows.length < 100) break;
  }

  log.info({ created, updated, gateway }, "[calls-sync] sincronização Api4com concluída");
  return { ok: true, created, updated };
}
