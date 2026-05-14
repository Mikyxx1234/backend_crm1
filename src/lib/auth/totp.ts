import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 — Time-Based One-Time Password (TOTP).
 *
 * Implementacao zero-dependency (so node:crypto). Compativel com Google
 * Authenticator, Microsoft Authenticator, Authy, 1Password, Bitwarden,
 * etc. (todos seguem o mesmo padrao):
 *   - HMAC-SHA1 (default em authenticators)
 *   - 30s step
 *   - 6 digits
 *   - secret base32 (RFC 4648)
 *
 * @see docs/mfa-totp.md
 */

const TOTP_DIGITS = 6;
const TOTP_PERIOD_SEC = 30;
const TOTP_ALGO = "sha1";

// Base32 alphabet (RFC 4648, no padding).
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const B32_INDEX: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < B32.length; i++) map[B32[i]] = i;
  return map;
})();

/** Gera um secret seguro de 20 bytes (160 bits) → 32 chars base32. */
export function generateTotpSecret(): string {
  const buf = randomBytes(20);
  return base32Encode(buf);
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 0x1f];
  return out;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    const idx = B32_INDEX[c];
    if (idx === undefined) {
      throw new Error(`Caractere base32 invalido: ${c}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * Gera um codigo TOTP a partir do secret (base32) e timestamp (em ms).
 * Default: tempo atual.
 */
export function generateTotp(
  secretBase32: string,
  timestampMs: number = Date.now(),
): string {
  const counter = Math.floor(timestampMs / 1000 / TOTP_PERIOD_SEC);
  const counterBuf = Buffer.alloc(8);
  // Big-endian uint64. JavaScript numbers cobrem ate 2^53, suficiente
  // ate o ano ~292277 (epoch / 30 = counter).
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter & 0xffffffff, 4);

  const key = base32Decode(secretBase32);
  const hmac = createHmac(TOTP_ALGO, key);
  hmac.update(counterBuf);
  const hash = hmac.digest();

  // RFC 4226 §5.4 — dynamic truncation.
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const mod = code % 10 ** TOTP_DIGITS;
  return mod.toString().padStart(TOTP_DIGITS, "0");
}

/**
 * Verifica um codigo TOTP com janela de tolerancia (default ±1 step =
 * ±30s). Tolerancia maior que 1 e geralmente over-permissive — clock
 * drift moderno e <2s.
 */
export function verifyTotp(
  secretBase32: string,
  candidate: string,
  options: { window?: number; timestampMs?: number } = {},
): boolean {
  const cleaned = candidate.replace(/\s+/g, "").trim();
  if (!/^\d{6}$/.test(cleaned)) return false;

  const window = options.window ?? 1;
  const ts = options.timestampMs ?? Date.now();

  for (let delta = -window; delta <= window; delta++) {
    const expected = generateTotp(
      secretBase32,
      ts + delta * TOTP_PERIOD_SEC * 1000,
    );
    // timingSafeEqual exige Buffers de mesmo length.
    if (expected.length === cleaned.length) {
      const a = Buffer.from(expected);
      const b = Buffer.from(cleaned);
      if (timingSafeEqual(a, b)) return true;
    }
  }
  return false;
}

/**
 * Gera URI otpauth:// pra exibir como QR Code no setup.
 *
 * Formato: otpauth://totp/<issuer>:<account>?secret=<base32>&issuer=<issuer>&algorithm=SHA1&digits=6&period=30
 *
 * Issuer e label sao escapados conforme spec (URL-encoded).
 */
export function buildOtpauthUri(params: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  const issuer = encodeURIComponent(params.issuer);
  const account = encodeURIComponent(params.account);
  const label = `${issuer}:${account}`;
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
