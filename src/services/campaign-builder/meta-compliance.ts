export const META_RETRYABLE_CODES = new Set([130429, 131048, 131056, 131049]);

export function extractMetaRetryCode(message: string): number | null {
  const match = message.match(/\b(130429|131048|131056|131049)\b/);
  return match ? Number(match[1]) : null;
}

export function isMetaRetryableError(message: string): boolean {
  const code = extractMetaRetryCode(message);
  return code !== null && META_RETRYABLE_CODES.has(code);
}

export function isInside24hWindow(lastInboundAt: Date | null, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < 24 * 60 * 60 * 1000;
}

export function isWindowExpiredError(message: string): boolean {
  return message.includes("META_WINDOW_EXPIRED_24H");
}

export function shouldRetryCampaignSendError(
  message: string,
  attemptsMade: number,
  maxAttempts: number,
): boolean {
  if (isWindowExpiredError(message)) return false;
  if (!isMetaRetryableError(message)) return false;
  const normalizedMax = Math.max(1, maxAttempts);
  const currentAttempt = attemptsMade + 1;
  return currentAttempt < normalizedMax;
}
