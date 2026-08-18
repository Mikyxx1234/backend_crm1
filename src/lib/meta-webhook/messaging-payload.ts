/**
 * Normaliza payloads de Messenger e Instagram Direct.
 *
 * Messenger / IG via Page: `entry[].messaging[]` com sender.id.
 * Instagram Login (campo messages): `entry[].changes[].value` com
 * `from` / `message` string / `messages[]`.
 */

export type MessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    attachments?: Array<{
      type?: string;
      payload?: { url?: string; sticker_id?: number };
    }>;
    is_echo?: boolean;
  };
  postback?: { mid?: string; title?: string; payload?: string };
  read?: { watermark?: number };
  delivery?: { mids?: string[]; watermark?: number };
};

export type WebhookEntry = {
  id?: unknown;
  time?: number;
  messaging?: MessagingEvent[];
  changes?: Array<{ field?: unknown; value?: unknown }>;
};

export function asMetaId(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return "";
}

export function configMetaIds(config: unknown): Set<string> {
  const ids = new Set<string>();
  if (!config || typeof config !== "object" || Array.isArray(config)) return ids;
  const c = config as Record<string, unknown>;
  for (const key of ["instagramUserId", "instagramAccountId", "pageId"] as const) {
    const id = asMetaId(c[key]);
    if (id) ids.add(id);
  }
  return ids;
}

function idFromActor(raw: unknown): string {
  const direct = asMetaId(raw);
  if (direct) return direct;
  if (raw && typeof raw === "object") {
    return asMetaId((raw as Record<string, unknown>).id);
  }
  return "";
}

function asTimestamp(value: unknown): number | undefined {
  let n: number | undefined;
  if (typeof value === "number" && Number.isFinite(value)) n = value;
  else if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) n = parsed;
    else {
      const ms = Date.parse(value);
      n = Number.isFinite(ms) ? ms : undefined;
    }
  }
  if (n == null) return undefined;
  if (n > 0 && n < 1e12) n *= 1000;
  return n;
}

function asMessage(
  raw: unknown,
  midFallback?: string,
): MessagingEvent["message"] | undefined {
  if (typeof raw === "string" && raw.trim()) {
    return { text: raw.trim(), mid: midFallback || undefined };
  }
  if (raw && typeof raw === "object") {
    const m = raw as Record<string, unknown>;
    const mid = asMetaId(m.mid) || midFallback || undefined;
    const text = typeof m.text === "string" ? m.text : undefined;
    return {
      ...(raw as MessagingEvent["message"]),
      ...(mid ? { mid } : {}),
      ...(text != null ? { text } : {}),
    };
  }
  return undefined;
}

function eventFromValue(
  value: Record<string, unknown>,
  entryId: string,
): MessagingEvent | null {
  const senderId = idFromActor(value.sender) || idFromActor(value.from);
  const recipientId =
    idFromActor(value.recipient) || asMetaId(value.recipient_id) || entryId;
  const mid = asMetaId(value.mid) || asMetaId(value.id);
  const message = asMessage(value.message, mid);
  const timestamp = asTimestamp(value.timestamp ?? value.created_time);

  if (!senderId && !message && !value.postback && !value.read && !value.delivery) {
    return null;
  }

  return {
    sender: senderId ? { id: senderId } : undefined,
    recipient: recipientId ? { id: recipientId } : undefined,
    timestamp,
    message,
    postback:
      value.postback && typeof value.postback === "object"
        ? (value.postback as MessagingEvent["postback"])
        : undefined,
    read: value.read && typeof value.read === "object" ? (value.read as object) : undefined,
    delivery:
      value.delivery && typeof value.delivery === "object"
        ? (value.delivery as object)
        : undefined,
  };
}

export function extractMessagingEvents(entry: WebhookEntry): MessagingEvent[] {
  if (Array.isArray(entry.messaging) && entry.messaging.length > 0) {
    return entry.messaging;
  }

  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  const out: MessagingEvent[] = [];
  const entryId = asMetaId(entry.id);

  for (const change of changes) {
    const field = typeof change.field === "string" ? change.field : "";
    if (
      field &&
      field !== "messages" &&
      field !== "messaging" &&
      field !== "message"
    ) {
      continue;
    }
    const value = change.value;
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;

    const nested = v.messages;
    if (Array.isArray(nested)) {
      for (const item of nested) {
        if (!item || typeof item !== "object") continue;
        const ev = eventFromValue(item as Record<string, unknown>, entryId);
        if (ev) out.push(ev);
      }
      continue;
    }

    const ev = eventFromValue(v, entryId);
    if (ev) out.push(ev);
  }

  return out;
}
