const GRAPH_VERSION = "v21.0";

/**
 * Estrutura oficial de erro do Graph/Cloud API (v16+), documentada em
 * https://developers.facebook.com/docs/graph-api/guides/error-handling/
 * e https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 *
 * A recomendação oficial da Meta é:
 * - Construir lógica de error-handling em cima de `code` (numérico).
 * - Usar `error_data.details` pra contexto acionável (texto human-readable
 *   com o motivo real, ex.: "Message failed to send because more than 24 hours
 *   have passed since the customer last replied to this number").
 * - Sempre logar `fbtrace_id` — é a chave que Meta Support usa pra investigar.
 * - `error_subcode` está deprecated em v16+, não confiar.
 * - `error_user_title`/`error_user_msg` aparecem em alguns erros do Graph
 *   com texto já pronto pra mostrar ao usuário final.
 */
export type MetaGraphErrorPayload = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
  error_data?: {
    messaging_product?: string;
    details?: string;
  };
};

type GraphErrorEnvelope = { error?: MetaGraphErrorPayload };

/**
 * Resposta de `pricing_analytics` (WABA fields). Cada `data_points[i]`
 * representa um bucket por (pricing_type, pricing_category, country,
 * phone, tier, start, end). `cost` vem em USD (Meta documenta como
 * "currency = USD" no recurso WABA).
 */
export type MetaPricingAnalyticsDataPoint = {
  /// Unix segundos UTC do inicio do bucket (DAILY = 00:00).
  start: number;
  /// Unix segundos UTC do fim do bucket.
  end: number;
  /// REGULAR | FREE_CUSTOMER_SERVICE | FREE_ENTRY_POINT
  pricing_type?: string;
  /// MARKETING | UTILITY | AUTHENTICATION | SERVICE | AUTHENTICATION_INTERNATIONAL
  pricing_category?: string;
  /// ISO-2 ou null
  country?: string | null;
  /// Telefone E.164 (com '+'), ex: "+5551..."
  phone?: string | null;
  /// "TIER_*" ou null
  tier?: string | null;
  /// Quantidade de mensagens cobradas neste bucket.
  volume: number;
  /// Custo em USD (numero decimal).
  cost: number;
};

export type MetaPricingAnalyticsResponse = {
  pricing_analytics?: {
    data_points?: MetaPricingAnalyticsDataPoint[];
  };
  id?: string;
};

/** SDP session (RFC 8866) — WhatsApp Cloud API Calling. */
export type WhatsAppCallSession = {
  sdp_type: "offer" | "answer" | string;
  sdp: string;
};

/** Resposta de `GET /{phone-number-id}?fields=...` — estado de saúde do número WABA. */
export type MetaPhoneNumberHealth = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  /** APPROVED | PENDING_REVIEW | DECLINED | EXPIRED | NONE */
  name_status?: string;
  /** VERIFIED | EXPIRED | NOT_VERIFIED */
  code_verification_status?: string;
  /** GREEN | YELLOW | RED | UNKNOWN */
  quality_rating?: string;
  /** CONNECTED | FLAGGED | RESTRICTED | PENDING | DISCONNECTED (nem sempre presente) */
  status?: string;
  platform_type?: string;
  /** TIER_50 | TIER_250 | TIER_1K | TIER_10K | TIER_100K | TIER_UNLIMITED */
  messaging_limit_tier?: string;
  /** LIVE | SANDBOX — "SANDBOX" pode significar número de teste. */
  account_mode?: string;
  throughput?: { level?: string };
};

/**
 * Erro estruturado ao chamar a Graph/Cloud API. Preserva todos os campos
 * documentados pela Meta (ver `MetaGraphErrorPayload`) pra que camadas
 * acima (persistência em `Message.sendError`, logs, UI) decidam o que
 * expor sem precisar re-parsear strings.
 */
export class MetaGraphError extends Error {
  readonly name = "MetaGraphError";
  readonly httpStatus: number;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly type: string | null;
  readonly fbtraceId: string | null;
  readonly details: string | null;
  readonly userTitle: string | null;
  readonly userMsg: string | null;
  readonly rawPayload: MetaGraphErrorPayload | null;

  constructor(init: {
    httpStatus: number;
    path: string;
    payload: MetaGraphErrorPayload | null;
  }) {
    const p = init.payload ?? {};
    const code = typeof p.code === "number" ? p.code : null;
    const subcode =
      typeof p.error_subcode === "number" ? p.error_subcode : null;
    const details = p.error_data?.details?.trim() || null;
    const userMsg = p.error_user_msg?.trim() || null;
    const baseMsg =
      details ||
      userMsg ||
      p.message?.trim() ||
      `Meta Graph HTTP ${init.httpStatus}`;

    const parts = [baseMsg];
    if (code != null) parts.push(`(code ${code}${subcode != null ? `/${subcode}` : ""})`);

    super(parts.join(" "));
    this.httpStatus = init.httpStatus;
    this.code = code;
    this.subcode = subcode;
    this.type = p.type?.trim() || null;
    this.fbtraceId = p.fbtrace_id?.trim() || null;
    this.details = details;
    this.userTitle = p.error_user_title?.trim() || null;
    this.userMsg = userMsg;
    this.rawPayload = init.payload;
  }

  /**
   * Representação canônica pra persistir em `Message.sendError`.
   * Formato: `${detailsOrMsg} (code CODE[/SUBCODE], fbtrace=XYZ)`.
   * O prefixo descritivo vai primeiro pra que a UI (que trunca) mostre
   * a parte acionável antes dos metadados técnicos.
   */
  toPersistedString(): string {
    const human =
      this.details ||
      this.userMsg ||
      this.message.replace(/\s*\(code [^)]+\)\s*$/i, "");
    const meta: string[] = [];
    if (this.code != null) {
      meta.push(`code ${this.code}${this.subcode != null ? `/${this.subcode}` : ""}`);
    }
    if (this.fbtraceId) meta.push(`fbtrace=${this.fbtraceId}`);
    return meta.length > 0 ? `${human} (${meta.join(", ")})` : human;
  }
}

export function isMetaGraphError(err: unknown): err is MetaGraphError {
  return err instanceof MetaGraphError;
}

/**
 * Formata qualquer erro para persistir em `Message.sendError` /
 * `CampaignRecipient.errorMessage`. Se for `MetaGraphError`, preserva
 * `code` + `fbtrace_id` + `details` conforme recomendação oficial.
 * Caso contrário, devolve `err.message` (ou a string crua).
 */
export function formatMetaSendError(err: unknown): string {
  if (isMetaGraphError(err)) return err.toPersistedString();
  if (err instanceof Error) return err.message;
  return String(err);
}

export class MetaWhatsAppClient {
  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly businessAccountId: string
  ) {}

  get configured(): boolean {
    return Boolean(this.accessToken?.trim() && this.phoneNumberId?.trim());
  }

  /** Token + número + WABA — necessário para API de templates na conta comercial. */
  get templatesConfigured(): boolean {
    return this.configured && Boolean(this.businessAccountId?.trim());
  }

  static buildGraphUrl(path: string): string {
    const p = path.startsWith("/") ? path.slice(1) : path;
    return `https://graph.facebook.com/${GRAPH_VERSION}/${p}`;
  }

  /** Destino Cloud API: `to` (telefone em dígitos) e/ou `recipient` (BSUID). Se ambos, a Meta prioriza o telefone. */
  private static recipientFields(to?: string, recipient?: string): { to?: string; recipient?: string } {
    const digits = (to ?? "").replace(/\D/g, "");
    const out: { to?: string; recipient?: string } = {};
    if (digits.length >= 8) out.to = digits;
    const r = recipient?.trim();
    if (r) out.recipient = r;
    if (!out.to && !out.recipient) {
      throw new Error("Meta WhatsApp: defina telefone (to) ou BSUID (recipient).");
    }
    return out;
  }

  private async graphFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = MetaWhatsAppClient.buildGraphUrl(path);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.accessToken}`);
    if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(url, { ...init, headers, cache: "no-store" });
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      const payload =
        data && typeof data === "object"
          ? ((data as GraphErrorEnvelope).error ?? null)
          : null;
      const err = new MetaGraphError({
        httpStatus: res.status,
        path,
        payload,
      });
      // Log estruturado — seguindo recomendação oficial:
      // sempre incluir fbtrace_id + code pra correlação com Meta Support.
      console.error(
        `[MetaWA] ${res.status} ${path} code=${err.code ?? "?"} subcode=${err.subcode ?? "?"} fbtrace=${err.fbtraceId ?? "?"} type=${err.type ?? "?"}: ${err.details ?? err.message}`,
      );
      throw err;
    }
    return data as T;
  }

  // ── Business profile ──────────────────────────

  async getBusinessProfile(): Promise<unknown> {
    return this.graphFetch(`${this.phoneNumberId}/whatsapp_business_profile`);
  }

  // ── Send text ─────────────────────────────────

  /**
   * @param to Telefone em dígitos (pode ser vazio se houver `recipient`).
   * @param recipient BSUID (ex. US.xxx). Envio só por BSUID depende da versão da API Meta (ver changelog).
   */
  /**
   * @param contextMessageId wamid da mensagem citada (resposta no fio do WhatsApp).
   */
  async sendText(
    to: string | undefined,
    text: string,
    recipient?: string,
    contextMessageId?: string | null
  ): Promise<{ messages: Array<{ id: string }> }> {
    const dest = MetaWhatsAppClient.recipientFields(to, recipient);
    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...dest,
      type: "text",
      text: { preview_url: true, body: text },
    };
    if (contextMessageId?.trim()) {
      payload.context = { message_id: contextMessageId.trim() };
    }
    return this.graphFetch(`${this.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // ── Send image ────────────────────────────────

  async sendImage(
    to: string | undefined,
    imageUrl: string,
    caption?: string,
    recipient?: string
  ): Promise<{ messages: Array<{ id: string }> }> {
    const dest = MetaWhatsAppClient.recipientFields(to, recipient);
    return this.graphFetch(`${this.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        ...dest,
        type: "image",
        image: { link: imageUrl, ...(caption ? { caption } : {}) },
      }),
    });
  }

  // ── Send document ─────────────────────────────

  async sendDocument(
    to: string | undefined,
    docUrl: string,
    filename: string,
    caption?: string,
    recipient?: string
  ): Promise<{ messages: Array<{ id: string }> }> {
    const dest = MetaWhatsAppClient.recipientFields(to, recipient);
    return this.graphFetch(`${this.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        ...dest,
        type: "document",
        document: { link: docUrl, filename, ...(caption ? { caption } : {}) },
      }),
    });
  }

  // ── Send video ────────────────────────────────

  async sendVideo(
    to: string | undefined,
    videoUrl: string,
    caption?: string,
    recipient?: string
  ): Promise<{ messages: Array<{ id: string }> }> {
    const dest = MetaWhatsAppClient.recipientFields(to, recipient);
    return this.graphFetch(`${this.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        ...dest,
        type: "video",
        video: { link: videoUrl, ...(caption ? { caption } : {}) },
      }),
    });
  }

  // ── Send audio ────────────────────────────────

  async sendAudio(
    to: string | undefined,
    audioUrl: string,
    recipient?: string
  ): Promise<{ messages: Array<{ id: string }> }> {
    const dest = MetaWhatsAppClient.recipientFields(to, recipient);
    return this.graphFetch(`${this.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        ...dest,
        type: "audio",
        audio: { link: audioUrl },
      }),
    });
  }

  // ── Send interactive buttons ──────────────────

  async sendInteractiveButtons(
    to: string | undefined,
    body: string,
    buttons: { id: string; title: string }[],
    header?: string,
    footer?: string,
    recipient?: string
  ): Promise<{ messages: Array<{ id: string }> }> {
    const dest = MetaWhatsAppClient.recipientFields(to, recipient);
    const interactive: Record<string, unknown> = {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    };
    if (header) interactive.header = { type: "text", text: header };
    if (footer) interactive.footer = { text: footer };

    return this.graphFetch(`${this.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        ...dest,
        type: "interactive",
        interactive,
      }),
    });
  }

  // ── Upload media ──────────────────────────────

  async uploadMedia(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: mimeType }),
      filename
    );
    form.append("type", mimeType);

    const url = MetaWhatsAppClient.buildGraphUrl(`${this.phoneNumberId}/media`);
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form,
      cache: "no-store",
    });

    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }

    const parsed = (data && typeof data === "object" ? data : {}) as {
      id?: string;
      error?: MetaGraphErrorPayload;
    };

    if (!res.ok || !parsed.id) {
      const payload = parsed.error ?? null;
      const err = new MetaGraphError({
        httpStatus: res.status,
        path: `${this.phoneNumberId}/media`,
        payload,
      });
      console.error(
        `[MetaWA] upload ${res.status} code=${err.code ?? "?"} fbtrace=${err.fbtraceId ?? "?"}: ${err.details ?? err.message}`,
      );
      throw err;
    }
    return parsed.id;
  }

  // ── Send media by ID ──────────────────────────

  async sendMediaById(
    to: string | undefined,
    mediaId: string,
    type: "image" | "audio" | "video" | "document",
    caption?: string,
    filename?: string,
    voice?: boolean,
    recipient?: string,
  ): Promise<{ messages: Array<{ id: string }> }> {
    const mediaPayload: Record<string, string | boolean> = { id: mediaId };
    if (caption) mediaPayload.caption = caption;
    if (filename) mediaPayload.filename = filename;
    if (type === "audio" && voice) mediaPayload.voice = true;

    const dest = MetaWhatsAppClient.recipientFields(to, recipient);

    return this.graphFetch(`${this.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        ...dest,
        type,
        [type]: mediaPayload,
      }),
    });
  }

  // ── Typing indicator + mark as read ────────────

  async sendTypingIndicator(messageId: string): Promise<void> {
    try {
      await this.graphFetch(`${this.phoneNumberId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          typing_indicator: { type: "text" },
        }),
      });
    } catch (err) {
      console.warn("[MetaWA] typing indicator failed:", err instanceof Error ? err.message : err);
    }
  }

  // ── Send template ─────────────────────────────

  async sendTemplate(
    to: string | undefined,
    templateName: string,
    languageCode: string = "pt_BR",
    components?: unknown[],
    recipient?: string,
  ): Promise<{ messages: Array<{ id: string }> }> {
    const dest = MetaWhatsAppClient.recipientFields(to, recipient);
    return this.graphFetch(`${this.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        ...dest,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          ...(components ? { components } : {}),
        },
      }),
    });
  }

  // ── Mark as read ──────────────────────────────

  async markAsRead(messageId: string): Promise<void> {
    await this.graphFetch(`${this.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
  }

  // ── Calling API (Cloud API) ───────────────────
  // @see https://developers.facebook.com/docs/whatsapp/cloud-api/calling

  private async postCall(body: Record<string, unknown>): Promise<unknown> {
    return this.graphFetch(`${this.phoneNumberId}/calls`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        ...body,
      }),
    });
  }

  /**
   * Ligação iniciada pelo negócio: envia SDP offer; resposta inclui `calls[].id`.
   */
  async initiateVoiceCall(
    toDigits: string,
    session: WhatsAppCallSession,
    bizOpaqueCallbackData?: string
  ): Promise<{ calls?: Array<{ id: string }> }> {
    const to = toDigits.replace(/\D/g, "");
    if (to.length < 8) throw new Error("Meta WhatsApp: telefone inválido para chamada.");
    const payload: Record<string, unknown> = {
      to,
      action: "connect",
      session,
    };
    if (bizOpaqueCallbackData) {
      payload.biz_opaque_callback_data = bizOpaqueCallbackData.slice(0, 512);
    }
    return this.postCall(payload) as Promise<{ calls?: Array<{ id: string }> }>;
  }

  async preAcceptCall(callId: string, session: WhatsAppCallSession): Promise<{ success?: boolean }> {
    return this.postCall({
      call_id: callId,
      action: "pre_accept",
      session,
    }) as Promise<{ success?: boolean }>;
  }

  async acceptCall(
    callId: string,
    session: WhatsAppCallSession,
    bizOpaqueCallbackData?: string
  ): Promise<{ success?: boolean }> {
    const payload: Record<string, unknown> = {
      call_id: callId,
      action: "accept",
      session,
    };
    if (bizOpaqueCallbackData) {
      payload.biz_opaque_callback_data = bizOpaqueCallbackData.slice(0, 512);
    }
    return this.postCall(payload) as Promise<{ success?: boolean }>;
  }

  async rejectCall(callId: string): Promise<{ success?: boolean }> {
    return this.postCall({
      call_id: callId,
      action: "reject",
    }) as Promise<{ success?: boolean }>;
  }

  async terminateCall(callId: string): Promise<{ success?: boolean }> {
    return this.postCall({
      call_id: callId,
      action: "terminate",
    }) as Promise<{ success?: boolean }>;
  }

  // ── Send reaction ─────────────────────────────

  async sendReaction(
    to: string | undefined,
    messageId: string,
    emoji: string,
    recipient?: string,
  ): Promise<unknown> {
    const dest = MetaWhatsAppClient.recipientFields(to, recipient);
    return this.graphFetch(`${this.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        ...dest,
        type: "reaction",
        reaction: { message_id: messageId, emoji },
      }),
    });
  }

  // ── Get media URL ─────────────────────────────

  async getMediaUrl(mediaId: string): Promise<string> {
    const data = await this.graphFetch<{ url: string }>(`${mediaId}`);
    return data.url;
  }

  // ── Download media ────────────────────────────

  async downloadMedia(mediaUrl: string): Promise<Buffer> {
    const res = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  // ── Phone numbers ─────────────────────────────

  async getPhoneNumbers(businessAccountId?: string): Promise<unknown> {
    const waba = businessAccountId ?? this.businessAccountId;
    return this.graphFetch(`${waba}/phone_numbers`);
  }

  /**
   * Retorna o estado de saúde do phone number configurado — usado pelo
   * healthcheck global do CRM pra detectar numero pausado/flagged/qualidade
   * baixa antes que operadores percam envios em silêncio.
   *
   * Campos documentados em
   * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers
   * Nem todos os tenants expõem todos os campos (ex: `throughput` exige
   * opt-in). Tratamos tudo como opcional.
   */
  async getPhoneNumberHealth(): Promise<MetaPhoneNumberHealth> {
    const fields = [
      "id",
      "display_phone_number",
      "verified_name",
      "name_status",
      "code_verification_status",
      "quality_rating",
      "status",
      "platform_type",
      "messaging_limit_tier",
      "throughput",
      "account_mode",
    ].join(",");
    return this.graphFetch<MetaPhoneNumberHealth>(
      `${this.phoneNumberId}?fields=${fields}`,
    );
  }

  // ── Message templates (Business Management API) ─────────────────
  // @see https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/message_templates/

  private wabaOrThrow(): string {
    const waba = this.businessAccountId?.trim();
    if (!waba) {
      throw new Error(
        "Meta: defina META_WHATSAPP_BUSINESS_ACCOUNT_ID (WABA) para gerir templates.",
      );
    }
    return waba;
  }

  /** Lista templates aprovados/pendentes da conta WhatsApp Business. */
  async listMessageTemplates(options?: {
    limit?: number;
    after?: string;
  }): Promise<unknown> {
    const waba = this.wabaOrThrow();
    const params = new URLSearchParams();
    params.set(
      "fields",
      [
        "name",
        "status",
        "category",
        "sub_category",
        "language",
        "id",
        "components",
        "quality_score",
        "rejected_reason",
        "last_updated_time",
      ].join(","),
    );
    params.set("limit", String(Math.min(options?.limit ?? 100, 500)));
    if (options?.after) params.set("after", options.after);
    return this.graphFetch(`${waba}/message_templates?${params.toString()}`);
  }

  /** Cria template (submete à análise da Meta). `payload` = corpo JSON oficial. */
  async createMessageTemplate(payload: Record<string, unknown>): Promise<unknown> {
    const waba = this.wabaOrThrow();
    return this.graphFetch(`${waba}/message_templates`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  /** Remove template pelo `id` Graph retornado na listagem. */
  async deleteMessageTemplate(templateGraphId: string): Promise<unknown> {
    const id = templateGraphId.trim();
    if (!id) throw new Error("ID do template inválido.");
    return this.graphFetch(id, { method: "DELETE" });
  }

  // ── Pricing analytics (oficial Meta — usado em /reports) ───────
  // @see https://developers.facebook.com/docs/whatsapp/business-management-api/analytics
  // Retorna o CUSTO REAL cobrado pela Meta no periodo, quebrado por
  // pricing_type (REGULAR | FREE_CUSTOMER_SERVICE | FREE_ENTRY_POINT)
  // x pricing_category (MARKETING | UTILITY | AUTHENTICATION |
  // SERVICE | AUTHENTICATION_INTERNATIONAL) x dimensao (COUNTRY,
  // PHONE, TIER). Granularity DAILY = 1 ponto por dia.
  //
  // A Meta espera unix timestamps em segundos (UTC) e tem um teto
  // de ~90 dias por chamada. Pra periodos maiores chamamos varias
  // vezes no service de sync.
  async getPricingAnalytics(input: {
    startUnix: number;
    endUnix: number;
    granularity?: "DAILY" | "MONTHLY" | "HALF_HOUR";
  }): Promise<MetaPricingAnalyticsResponse> {
    const waba = this.wabaOrThrow();
    const granularity = input.granularity ?? "DAILY";
    const fields =
      `pricing_analytics` +
      `.start(${input.startUnix})` +
      `.end(${input.endUnix})` +
      `.granularity(${granularity})` +
      `.pricing_types(["REGULAR","FREE_CUSTOMER_SERVICE","FREE_ENTRY_POINT"])` +
      `.pricing_categories(["MARKETING","UTILITY","AUTHENTICATION","SERVICE","AUTHENTICATION_INTERNATIONAL"])` +
      `.dimensions(["COUNTRY","PHONE","TIER"])`;
    const params = new URLSearchParams({ fields });
    return this.graphFetch<MetaPricingAnalyticsResponse>(
      `${waba}?${params.toString()}`,
    );
  }

  // ── Legacy aliases ────────────────────────────

  async sendMessage(
    to: string | undefined,
    text: string,
    recipient?: string,
    contextMessageId?: string | null
  ) {
    return this.sendText(to, text, recipient, contextMessageId);
  }

  async getQRCode(phoneNumberId?: string): Promise<unknown> {
    return this.graphFetch(`${phoneNumberId ?? this.phoneNumberId}/message_qrdls`);
  }

  async getMessageQrDlByCode(phoneNumberId: string, code: string): Promise<unknown> {
    return this.graphFetch(`${phoneNumberId}/message_qrdls/${encodeURIComponent(code)}`);
  }

  async generateQRCode(phoneNumberId: string, prefilledMessage: string): Promise<unknown> {
    return this.graphFetch(`${phoneNumberId}/message_qrdls`, {
      method: "POST",
      body: JSON.stringify({
        prefilled_message: prefilledMessage,
        generate_qr_image: "PNG",
      }),
    });
  }
}

// ── Singleton from env ──────────────────────────

export const metaWhatsApp = new MetaWhatsAppClient(
  process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() ?? "",
  process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "",
  process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() ?? ""
);

/**
 * Build a MetaWhatsAppClient from a channel's stored config (Embedded Signup).
 * Falls back to the env-var singleton if config is missing required fields.
 */
export function metaClientFromConfig(
  config: Record<string, unknown> | null | undefined,
): MetaWhatsAppClient {
  if (!config) return metaWhatsApp;
  const token = typeof config.accessToken === "string" ? config.accessToken.trim() : "";
  const phoneId = typeof config.phoneNumberId === "string" ? config.phoneNumberId.trim() : "";
  const wabaId = typeof config.businessAccountId === "string" ? config.businessAccountId.trim() : "";
  if (!token || !phoneId) return metaWhatsApp;
  return new MetaWhatsAppClient(token, phoneId, wabaId);
}
