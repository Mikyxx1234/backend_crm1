import { createHash } from "node:crypto";

export const WHATSAPP_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function normalizeHoursBeforeExpiry(value: unknown): number | null {
  const hours =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(hours) && hours > 0 && hours < 24 ? hours : null;
}

export function getSessionExpiryWindow(
  lastInboundAt: Date,
  hoursBeforeExpiry: number,
  now = new Date(),
): { lastInboundAt: Date; sessionExpiresAt: Date } | null {
  const hours = normalizeHoursBeforeExpiry(hoursBeforeExpiry);
  if (hours === null) return null;

  const sessionExpiresAt = new Date(
    lastInboundAt.getTime() + WHATSAPP_SESSION_WINDOW_MS,
  );
  const horizon = now.getTime() + hours * 60 * 60 * 1000;
  if (
    sessionExpiresAt.getTime() <= now.getTime() ||
    sessionExpiresAt.getTime() > horizon
  ) {
    return null;
  }
  return { lastInboundAt, sessionExpiresAt };
}

export function buildSessionExpiryClaimKey(
  automationId: string,
  contactId: string,
  channel: string,
  windowStartedAt: Date,
): string {
  return createHash("sha256")
    .update(
      `${automationId}\0${contactId}\0${channel}\0${windowStartedAt.toISOString()}`,
    )
    .digest("hex");
}
