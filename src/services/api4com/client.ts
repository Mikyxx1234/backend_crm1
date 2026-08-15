/**
 * Cliente HTTP da Api4com — provisionamento + discagem.
 *
 * Usado pelo ProvisioningService (Fase 2) e pelo DialerService (Fase 4).
 * O cliente legado em telephony-providers/api4com.ts continua existindo para
 * o fluxo manual ("Conectar Api4com" em settings); novos consumidores devem
 * usar este módulo.
 *
 * Auth: header `Authorization: <token>`. O token é da conta de serviço ADMIN
 * (POST /users/accessTokens com ttl: -1) lido de env `API4COM_SERVICE_TOKEN`.
 *
 * Retry: backoff exponencial em 5xx e timeout de rede. NUNCA repete em 4xx
 * (validação determinística do servidor).
 *
 * Ver .cursor/rules/api4com.mdc para os fatos verificados da API.
 */
import { z } from "zod";

import { getLogger } from "@/lib/logger";

import {
  Api4ComAuthError,
  Api4ComConflictError,
  Api4ComError,
  Api4ComServerError,
  Api4ComValidationError,
} from "./errors";
import {
  AccessTokenResponseSchema,
  Api4ComExtensionListItemSchema,
  Api4ComExtensionResponseSchema,
  Api4ComUserSchema,
  CreateUserRequestSchema,
  DialerAckSchema,
  DialerRequestSchema,
  IntegrationPatchSchema,
  type Api4ComExtensionResponse,
  type Api4ComUser,
  type CreateExtensionInput,
  type CreateUserRequest,
  type DialerAck,
  type DialerRequest,
  type IntegrationPatch,
} from "./types";

const log = getLogger("api4com-client");

const DEFAULT_BASE_URL = "https://api.api4com.com/api/v1";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 250;
/** /dialer mantém a conexão aberta durante a chamada — ack curto basta. */
const DIALER_ACK_MS = 5_000;

export type Api4ComClientOptions = {
  baseUrl?: string;
  /** Token ADMIN ttl:-1. Caso ausente, lê `API4COM_SERVICE_TOKEN` do env. */
  token?: string;
  timeoutMs?: number;
  /** Timeout específico do POST /dialer (ack curto). Default 5_000ms. */
  dialerAckMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  /** Permite injetar um fetch (testes). Default: globalThis.fetch. */
  fetchImpl?: typeof fetch;
};

type RequestOptions<T> = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  schema: z.ZodType<T>;
  /** /dialer responde lentamente — ack curto + timeout específico. */
  ackTimeoutMs?: number;
  /** Quando true, ignora retry (semântica de longa duração). */
  noRetry?: boolean;
};

export class Api4ComClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly dialerAckMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: Api4ComClientOptions = {}) {
    const token = opts.token ?? process.env.API4COM_SERVICE_TOKEN;
    if (!token) {
      throw new Api4ComError(
        "Token Api4com ausente. Defina API4COM_SERVICE_TOKEN ou passe `token` no construtor.",
      );
    }
    this.token = token;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.dialerAckMs = opts.dialerAckMs ?? DIALER_ACK_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  // ── Endpoints ───────────────────────────────────────────────────────────

  /**
   * POST /users/accessTokens — gera token ADMIN ttl:-1.
   * Usado uma vez por org para bootstrap; depois persiste em secret manager.
   * Requer um token ADMIN preexistente (ex.: token temporário de login).
   */
  async createAccessToken(adminTokenOverride?: string): Promise<string> {
    const self = this as unknown as { token: string };
    const previousToken = self.token;
    if (adminTokenOverride) self.token = adminTokenOverride;
    try {
      const data = await this.request({
        method: "POST",
        path: "/users/accessTokens",
        body: { ttl: -1 },
        schema: AccessTokenResponseSchema,
      });
      return data.id;
    } finally {
      if (adminTokenOverride) self.token = previousToken;
    }
  }

  /** POST /users — cria usuário. 409/validação "já existe" → Api4ComConflictError. */
  async createUser(input: CreateUserRequest): Promise<Api4ComUser> {
    const parsed = CreateUserRequestSchema.parse(input);
    const raw = await this.request({
      method: "POST",
      path: "/users",
      body: parsed,
      schema: z.unknown(),
    });
    const user = Api4ComUserSchema.safeParse(raw);
    if (user.success) return user.data;
    const found = await this.findUsers({ email: parsed.email });
    if (found[0]) return found[0];
    throw new Api4ComError(
      "Usuário criado na Api4com, mas a resposta não trouxe id/uuid.",
      { endpoint: "/users", responseBody: JSON.stringify(raw).slice(0, 500) },
    );
  }

  /** GET /users — filtra por e-mail (LoopBack where + filtro local). */
  async findUsers(filter?: { email?: string }): Promise<Api4ComUser[]> {
    const qs = filter?.email
      ? `?filter=${encodeURIComponent(JSON.stringify({ where: { email: filter.email } }))}`
      : "";
    const users = await this.request({
      method: "GET",
      path: `/users${qs}`,
      schema: parseUsersListSchema,
    });
    if (!filter?.email) return users;
    const email = filter.email.toLowerCase();
    return users.filter((u) => u.email?.toLowerCase() === email);
  }

  /** GET /extensions — lista ramais da conta. */
  async listExtensions(): Promise<z.infer<typeof Api4ComExtensionListItemSchema>[]> {
    return this.request({
      method: "GET",
      path: "/extensions",
      schema: parseExtensionsListSchema,
    });
  }

  /**
   * Aloca um ramal via POST /extensions (docs oficiais).
   * Tenta /extensions/nextAvailable primeiro; 404 cai no fluxo oficial.
   */
  async createNextExtension(input: CreateExtensionInput = {}): Promise<Api4ComExtensionResponse> {
    try {
      return await this.request({
        method: "POST",
        path: "/extensions/nextAvailable",
        schema: Api4ComExtensionResponseSchema,
      });
    } catch (err) {
      if (!(err instanceof Api4ComValidationError) || err.status !== 404) {
        throw err;
      }
      log.warn("[api4com] /extensions/nextAvailable não existe (404). Criando via POST /extensions.");
    }

    const existing = await this.listExtensions();
    const reused = this.extensionFromEmail(existing, input.email);
    if (reused) {
      log.warn(`[api4com] ramal ${reused.ramal} já existe para ${input.email} — reutilizando.`);
      return reused;
    }

    const taken = existing.map((e) => e.ramal);
    const [first, ...rest] = (input.firstName ?? "CRM").trim().split(/\s+/);
    const firstName = first || "CRM";
    const lastName = input.lastName?.trim() || rest.join(" ") || "User";

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ramal = nextRamalNumber(taken);
      const senha = generateExtensionPassword();
      try {
        return await this.request({
          method: "POST",
          path: "/extensions",
          body: {
            ramal,
            senha,
            first_name: firstName,
            last_name: lastName,
            email_address: input.email,
            gravar_audio: 1,
          },
          schema: Api4ComExtensionResponseSchema,
        });
      } catch (err) {
        lastErr = err;
        if (isEmailUniquenessError(err) && input.email) {
          const listed = await this.listExtensions();
          const match = this.extensionFromEmail(listed, input.email);
          if (match) return match;
        }
        if (
          err instanceof Api4ComConflictError ||
          (err instanceof Api4ComValidationError && isConflictBody(err.responseBody ?? err.message))
        ) {
          taken.push(ramal);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  private extensionFromEmail(
    listed: z.infer<typeof Api4ComExtensionListItemSchema>[],
    email?: string,
  ): Api4ComExtensionResponse | null {
    if (!email) return null;
    const needle = email.toLowerCase();
    const match = listed.find((e) => e.email_address?.toLowerCase() === needle);
    if (!match?.senha || !match.domain) return null;
    return {
      id: match.id,
      ramal: match.ramal,
      senha: match.senha,
      domain: match.domain,
      email_address: match.email_address ?? undefined,
    };
  }

  /** DELETE /extensions/{id} — 404 = já inexistente (idempotente). */
  async deleteExtension(extensionId: string): Promise<void> {
    try {
      await this.request({
        method: "DELETE",
        path: `/extensions/${encodeURIComponent(extensionId)}`,
        schema: z.unknown(),
      });
    } catch (err) {
      if (err instanceof Api4ComValidationError && err.status === 404) {
        log.warn(`[api4com] ramal ${extensionId} já inexistente (404).`);
        return;
      }
      throw err;
    }
  }

  /**
   * DELETE /users/{id} — endpoint não documentado.
   * 404/405 = já inexistente ou não suportado (best-effort).
   */
  async deleteUser(userId: string): Promise<{ deleted: boolean }> {
    try {
      await this.request({
        method: "DELETE",
        path: `/users/${encodeURIComponent(userId)}`,
        schema: z.unknown(),
      });
      return { deleted: true };
    } catch (err) {
      if (
        err instanceof Api4ComValidationError &&
        (err.status === 404 || err.status === 405)
      ) {
        log.warn(
          `[api4com] DELETE /users/${userId} retornou ${err.status} — ignorando.`,
        );
        return { deleted: false };
      }
      throw err;
    }
  }

  /** PATCH /integrations — configura webhook + gateway. */
  async upsertIntegration(input: IntegrationPatch): Promise<void> {
    const parsed = IntegrationPatchSchema.parse(input);
    await this.request({
      method: "PATCH",
      path: "/integrations",
      body: parsed,
      schema: z.unknown(),
    });
  }

  /**
   * POST /dialer — inicia chamada. Importante:
   *   - ack curto (5s); se não responde, assume "discagem em andamento"
   *     e retorna { id: undefined }.
   *   - O `id` retornado NÃO é o callId real (vem pelo webhook).
   */
  async dial(input: DialerRequest): Promise<DialerAck> {
    const parsed = DialerRequestSchema.parse(input);
    try {
      return await this.request({
        method: "POST",
        path: "/dialer",
        body: parsed,
        schema: DialerAckSchema,
        ackTimeoutMs: this.dialerAckMs,
        noRetry: true,
      });
    } catch (err) {
      if (err instanceof Api4ComDialerAckTimeout) {
        return { id: undefined };
      }
      throw err;
    }
  }

  /** DELETE /dialer/:id — encerra chamada usando o id retornado por dial(). */
  async hangup(dialerSessionId: string): Promise<void> {
    await this.request({
      method: "DELETE",
      path: `/dialer/${encodeURIComponent(dialerSessionId)}`,
      schema: z.unknown(),
    });
  }

  // ── Núcleo ──────────────────────────────────────────────────────────────

  private async request<T>(opts: RequestOptions<T>): Promise<T> {
    const url = `${this.baseUrl}${opts.path}`;
    const maxRetries = opts.noRetry ? 0 : this.maxRetries;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeOnce(url, opts);
      } catch (err) {
        lastError = err;
        if (!shouldRetry(err) || attempt === maxRetries) break;
        const delay = this.retryBaseMs * 2 ** attempt;
        log.warn(
          `[api4com] tentativa ${attempt + 1}/${maxRetries + 1} falhou: ${
            err instanceof Error ? err.message : String(err)
          } — retry em ${delay}ms`,
        );
        await sleep(delay);
      }
    }
    throw lastError;
  }

  private async executeOnce<T>(url: string, opts: RequestOptions<T>): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = opts.ackTimeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: opts.method,
        headers: {
          Authorization: this.token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        if (opts.ackTimeoutMs && opts.path.startsWith("/dialer")) {
          throw new Api4ComDialerAckTimeout();
        }
        throw new Api4ComError("Timeout ao contactar Api4com.", { endpoint: opts.path });
      }
      throw new Api4ComError(
        `Falha de rede ao contactar Api4com: ${err instanceof Error ? err.message : String(err)}`,
        { endpoint: opts.path },
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text().catch(() => "");

    if (res.status === 401 || res.status === 403) {
      throw new Api4ComAuthError("Token Api4com inválido ou expirado.", {
        status: res.status,
        endpoint: opts.path,
        responseBody: text.slice(0, 500),
      });
    }

    if (res.status === 409 || isConflictBody(text)) {
      throw new Api4ComConflictError("Recurso já existe na Api4com.", {
        status: res.status,
        endpoint: opts.path,
        responseBody: text.slice(0, 500),
      });
    }

    if (res.status >= 400 && res.status < 500) {
      throw new Api4ComValidationError(
        `Api4com recusou a requisição (${res.status}). ${formatApi4ComErrorBody(text)}`.trim(),
        { status: res.status, endpoint: opts.path, responseBody: text.slice(0, 800) },
      );
    }

    if (res.status >= 500) {
      throw new Api4ComServerError(`Api4com retornou ${res.status}.`, {
        status: res.status,
        endpoint: opts.path,
        responseBody: text.slice(0, 500),
      });
    }

    if (!res.ok) {
      throw new Api4ComError(`Resposta inesperada (${res.status}).`, {
        status: res.status,
        endpoint: opts.path,
      });
    }

    if (!text) {
      return opts.schema.parse(undefined);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Api4ComError("Resposta da Api4com não é JSON válido.", {
        endpoint: opts.path,
        responseBody: text.slice(0, 500),
      });
    }
    const result = opts.schema.safeParse(json);
    if (!result.success) {
      throw new Api4ComError(
        `Resposta da Api4com fora do schema esperado: ${result.error.message}`,
        { endpoint: opts.path, responseBody: text.slice(0, 500) },
      );
    }
    return result.data;
  }
}

// ── Helpers internos ────────────────────────────────────────────────────────

class Api4ComDialerAckTimeout extends Error {
  constructor() {
    super("Dialer ack timeout (chamada provavelmente em andamento).");
  }
}

function shouldRetry(err: unknown): boolean {
  if (err instanceof Api4ComServerError) return true;
  if (err instanceof Api4ComError && !err.status) return true; // rede/timeout sem status
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Heurística pra detectar 200 com payload "já existe" (algumas APIs respondem
 * 200 + body de erro para tentativa de criar duplicado).
 */
function isConflictBody(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes("already exists") ||
    lower.includes("já existe") ||
    lower.includes("ja existe") ||
    lower.includes("duplicate") ||
    lower.includes("not unique") ||
    lower.includes("is not unique")
  );
}

function formatApi4ComErrorBody(text: string): string {
  if (!text) return "";
  try {
    const json = JSON.parse(text) as { error?: unknown };
    const err = json.error;
    if (typeof err === "string") return err.slice(0, 400);
    if (err && typeof err === "object") {
      const rec = err as { message?: unknown; details?: unknown };
      const msg = typeof rec.message === "string" ? rec.message : "";
      const details = rec.details ? ` ${JSON.stringify(rec.details)}` : "";
      const combined = `${msg}${details}`.trim();
      if (combined) return combined.slice(0, 400);
    }
  } catch {
    /* corpo não-JSON */
  }
  return text.slice(0, 400);
}

function isEmailUniquenessError(err: unknown): boolean {
  if (!(err instanceof Api4ComError)) return false;
  const text = `${err.message} ${err.responseBody ?? ""}`.toLowerCase();
  return /email/.test(text) && /unique|already|existe|duplicate/.test(text);
}

function nextRamalNumber(ramais: string[]): string {
  let max = 999;
  for (const raw of ramais) {
    const n = Number.parseInt(String(raw).replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

function generateExtensionPassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/** Aceita array direto ou `{ data: [] }` / `{ items: [] }`. */
const parseExtensionsListSchema = z.unknown().transform((raw) => {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Array.isArray((raw as { data?: unknown[] }).data)
        ? (raw as { data: unknown[] }).data
        : Array.isArray((raw as { items?: unknown[] }).items)
          ? (raw as { items: unknown[] }).items
          : []
      : [];
  return arr
    .map((entry) => Api4ComExtensionListItemSchema.safeParse(entry))
    .filter((r): r is z.ZodSafeParseSuccess<z.infer<typeof Api4ComExtensionListItemSchema>> => r.success)
    .map((r) => r.data);
});

/** Aceita array direto ou `{ data: [] }` / `{ items: [] }`. */
const parseUsersListSchema = z.unknown().transform((raw): Api4ComUser[] => {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Array.isArray((raw as { data?: unknown[] }).data)
        ? (raw as { data: unknown[] }).data
        : Array.isArray((raw as { items?: unknown[] }).items)
          ? (raw as { items: unknown[] }).items
          : []
      : [];
  return arr
    .map((entry) => Api4ComUserSchema.safeParse(entry))
    .filter((r): r is z.ZodSafeParseSuccess<Api4ComUser> => r.success)
    .map((r) => r.data);
});

// ── Singleton de conveniência ───────────────────────────────────────────────

let cachedClient: Api4ComClient | null = null;

/**
 * Cliente compartilhado lendo `API4COM_SERVICE_TOKEN` do env. Para testes,
 * instancie diretamente `new Api4ComClient({ token, fetchImpl })`.
 */
export function getApi4ComClient(): Api4ComClient {
  if (!cachedClient) cachedClient = new Api4ComClient();
  return cachedClient;
}

/** Útil para testes que precisam resetar o singleton. */
export function resetApi4ComClient(): void {
  cachedClient = null;
}
