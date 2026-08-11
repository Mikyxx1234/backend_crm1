/**
 * Hard caps for Campaign.sendRate.
 *
 * Unit: messages per second (msgs/s) — see prisma Campaign.sendRate and
 * `waitForMetaThrottle` in campaign-worker (`intervalMs = 1000 / rate`).
 *
 * Env overrides (ops):
 * - CAMPAIGN_SEND_RATE_MAX (default 30)
 * - CAMPAIGN_SEND_RATE_DEFAULT (default 20, never above max)
 * - CAMPAIGN_SEND_CONCURRENCY (default 4) — used by campaign-worker
 */

function envPositiveInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

/** Sensible defaults when env is unset. */
export const CAMPAIGN_SEND_RATE_MAX = 30;
export const CAMPAIGN_SEND_RATE_DEFAULT = 20;
export const CAMPAIGN_SEND_CONCURRENCY_DEFAULT = 4;

/** Absolute ceiling for campaign sendRate (msgs/s). */
export function getCampaignSendRateMax(): number {
  return envPositiveInt("CAMPAIGN_SEND_RATE_MAX", CAMPAIGN_SEND_RATE_MAX);
}

/** Default for new campaigns when sendRate is unset. */
export function getCampaignSendRateDefault(): number {
  const max = getCampaignSendRateMax();
  const d = envPositiveInt("CAMPAIGN_SEND_RATE_DEFAULT", CAMPAIGN_SEND_RATE_DEFAULT);
  return Math.min(d, max);
}

/** Clamp to [1, max] — defense-in-depth for worker + writes. */
export function clampCampaignSendRate(sendRate: number): number {
  const max = getCampaignSendRateMax();
  if (!Number.isFinite(sendRate)) return getCampaignSendRateDefault();
  return Math.max(1, Math.min(max, Math.floor(sendRate)));
}

/** Resolve write value: unset → default; set → clamp. */
export function resolveCampaignSendRate(sendRate?: number | null): number {
  if (sendRate === undefined || sendRate === null) {
    return getCampaignSendRateDefault();
  }
  return clampCampaignSendRate(sendRate);
}

/** BullMQ send-worker concurrency (lower = less PG/Meta pressure). */
export function getCampaignSendConcurrency(): number {
  return envPositiveInt(
    "CAMPAIGN_SEND_CONCURRENCY",
    CAMPAIGN_SEND_CONCURRENCY_DEFAULT,
  );
}
