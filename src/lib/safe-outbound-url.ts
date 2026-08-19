import { lookup } from "node:dns/promises";

/**
 * Bloqueia SSRF em webhooks de automação (URL digitada pelo operador).
 * Só http(s); recusa loopback, link-local, RFC1918 e hostnames internos.
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
]);

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inCidr(ip: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (base & mask);
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n == null) return false;
  return (
    inCidr(n, ipv4ToInt("0.0.0.0")!, 8) ||
    inCidr(n, ipv4ToInt("10.0.0.0")!, 8) ||
    inCidr(n, ipv4ToInt("127.0.0.0")!, 8) ||
    inCidr(n, ipv4ToInt("169.254.0.0")!, 16) ||
    inCidr(n, ipv4ToInt("172.16.0.0")!, 12) ||
    inCidr(n, ipv4ToInt("192.168.0.0")!, 16) ||
    inCidr(n, ipv4ToInt("100.64.0.0")!, 10)
  );
}

function isBlockedIpv6(ip: string): boolean {
  const raw = ip.toLowerCase();
  if (raw === "::1" || raw === "::" || raw === "0:0:0:0:0:0:0:1") return true;
  if (raw.startsWith("fe80:") || raw.startsWith("fc") || raw.startsWith("fd")) return true;
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]!);
  return false;
}

function isBlockedIp(ip: string): boolean {
  return ip.includes(":") ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) {
    return true;
  }
  return isBlockedIp(h);
}

export async function assertSafeOutboundUrl(raw: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("webhook: URL inválida");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("webhook: só http/https são permitidos");
  }
  const host = parsed.hostname;
  if (!host || isBlockedHostname(host)) {
    throw new Error("webhook: destino interno/privado bloqueado");
  }
  let records: Array<{ address: string }>;
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new Error("webhook: host não resolvido");
  }
  if (records.length === 0 || records.some((r) => isBlockedIp(r.address))) {
    throw new Error("webhook: destino interno/privado bloqueado");
  }
}
