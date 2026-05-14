/**
 * Redacao defensiva de payloads antes de gravar em AuditLog.
 *
 * Mantem em sync com src/lib/logger.ts SENSITIVE_KEYS — qualquer chave
 * sensivel listada la NAO aparece em logs nem em audit.
 *
 * Estrategia:
 *   - chaves listadas (case-insensitive) sao substituidas por "[REDACTED]"
 *   - aplica recursivo em objetos e arrays
 *   - strings com padrao de token JWT, accessToken Meta, etc. sao
 *     substituidas mesmo se a chave nao bater
 *
 * @see docs/audit-log.md
 */

const SENSITIVE_KEYS = new Set(
  [
    "password",
    "hashedpassword",
    "passwordhash",
    "newpassword",
    "currentpassword",
    "passwordconfirmation",
    "secret",
    "apisecret",
    "appsecret",
    "clientsecret",
    "verifytoken",
    "accesstoken",
    "refreshtoken",
    "token",
    "apitoken",
    "bearer",
    "authorization",
    "cookie",
    "setcookie",
    "x-api-key",
    "mfasecret",
    "totpsecret",
    "otpsecret",
    "codehash",
    "backupcode",
    "encryptionkey",
    "keyringsecret",
    "privatekey",
    "anthropicapikey",
    "openaiapikey",
    "smtppass",
  ].map((k) => k.toLowerCase()),
);

const TOKEN_PATTERNS: RegExp[] = [
  /^enc:v1:/, // ja encriptado (KEYRING_SECRET) — nao revele estrutura
  /^EAA[A-Za-z0-9_-]{20,}$/, // Meta access tokens
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, // JWT
  /^bw_[A-Za-z0-9_-]{40,}$/, // BullMQ tokens (se aparecer)
];

const REDACTED = "[REDACTED]";

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED; // hard cap pra nao explodir em ciclo
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    for (const re of TOKEN_PATTERNS) {
      if (re.test(value)) return REDACTED;
    }
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = redactValue(v, depth + 1);
    }
  }
  return out;
}

/**
 * Reduz um snapshot pra apenas as chaves listadas (allowlist).
 * Usado em modelos com muitos campos pra evitar gravar JSON gigante.
 */
export function pickFields<T extends Record<string, unknown>>(
  obj: T | null | undefined,
  fields: ReadonlyArray<keyof T & string>,
): Partial<T> | null {
  if (!obj) return null;
  const out: Partial<T> = {};
  for (const f of fields) {
    if (f in obj) (out as Record<string, unknown>)[f] = obj[f];
  }
  return out;
}
