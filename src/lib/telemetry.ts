/**
 * Wrapper sobre `@opentelemetry/api` (PR 2.2).
 *
 * O SDK Node (auto-instrumentations + exporters OTLP) é registrado em
 * `instrumentation-otel.ts` *somente* quando `OTEL_EXPORTER_OTLP_ENDPOINT`
 * está setado. Sem esse env, o `@opentelemetry/api` retorna um tracer/meter
 * no-op — chamadas a `withSpan(...)` não fazem nada e custam ~0ns.
 *
 * Por que separar?
 *   - Em dev local, ninguém quer subir Tempo só pra rodar `next dev`.
 *   - Em prod self-host, basta apontar pro Tempo do compose: 1 env var.
 *   - Em prod SaaS futuro (Grafana Cloud), troca a URL e pronto — sem
 *     tocar em call-site.
 *
 * Convenções
 * ──────────
 * - **Sempre passe `organizationId`** quando disponível: `setAttributes({
 *   "tenant.organization_id": orgId })`. Permite filtrar traces por cliente
 *   no Grafana/Tempo.
 * - **Spans manuais**: prefira `withSpan(name, fn)` em vez de criar/finalizar
 *   manualmente. O wrapper cuida de status/exception/end mesmo se `fn` lançar.
 * - **NÃO** loga PII em atributos (`http.url` puro vaza phone em querystring,
 *   por exemplo). Use o template do route quando possível.
 */

import {
  context,
  trace,
  SpanStatusCode,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

const TRACER_NAME = "crm-eduit";

let cachedTracer: Tracer | null = null;
function getTracer(): Tracer {
  if (!cachedTracer) cachedTracer = trace.getTracer(TRACER_NAME);
  return cachedTracer;
}

export type SpanOptions = {
  attributes?: Attributes;
  /** organizationId, anexado como `tenant.organization_id`. */
  organizationId?: string | null;
};

/**
 * Executa `fn` dentro de um novo span. Se `fn` lançar, marca o span como
 * ERROR + recordException e re-lança. Sempre fecha o span no finally.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  opts: SpanOptions = {},
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (opts.attributes) span.setAttributes(opts.attributes);
      if (opts.organizationId)
        span.setAttribute("tenant.organization_id", opts.organizationId);
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof Error) span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Anexa atributos ao span ATIVO (se houver). No-op se nenhum span ativo.
 * Útil pra acrescentar `organizationId` depois que ele é resolvido dentro
 * do handler.
 */
export function setSpanAttribute(key: string, value: string | number | boolean): void {
  const span = trace.getActiveSpan();
  if (span) span.setAttribute(key, value);
}

/**
 * Marca o span ativo como erro (sem fechá-lo). Útil quando capturamos um
 * erro mas decidimos não lançar (e.g. fallback para Baileys).
 */
export function recordSpanError(err: unknown): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  if (err instanceof Error) {
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  } else {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
  }
}

/**
 * Re-export de `context` pra call-sites que precisam acoplar contextos
 * manualmente (ex.: `context.with(...)` em fila de jobs).
 */
export { context, trace };
