/**
 * Stub de `@opentelemetry/api` para o bundle do middleware (Edge Runtime).
 *
 * Por que existe (resumo):
 *   O Next.js 15 inclui código de tracing direto no bundle do middleware
 *   sempre que detecta `@opentelemetry/api` nas deps. Trechos minificados
 *   no `.next/server/src/middleware.js` compilado mostram, por exemplo:
 *     aI = d.createContextKey("next.rootSpanId")
 *     aB.getTracer("next.js", "0.0.1")
 *   Esse tracing depende de APIs do `@opentelemetry/api` (`createContextKey`,
 *   `context.setValue/getValue`, `trace.getTracer().startSpan`, etc.) que
 *   não rodam no V8 isolate do Edge sem o pacote real — que por sua vez
 *   não pode ser carregado lá (`Native module not found`).
 *
 *   Não dá pra desligar essa instrumentação via config: o Next 15 removeu
 *   `experimental.instrumentationHook` e a única forma de impedir o include
 *   seria remover `@opentelemetry/api` das deps inteiras — o que mata o
 *   tracing real no bundle Node (PR 2.2). Trade-off ruim.
 *
 * Estratégia: alias do webpack faz `@opentelemetry/api` -> este arquivo
 * SOMENTE no bundle Edge. O bundle Node continua usando o pacote real.
 *
 * Implementação: **Proxy recursivo no-op**. Cada acesso a propriedade
 * retorna outro Proxy; cada chamada como função retorna outro Proxy
 * (que pode receber novo .x.y.z(...) infinitamente). Isso elimina o
 * jogo de "whack-a-mole" — qualquer API que o Next/deps chamarem,
 * presente ou futura, "funciona" (retorna no-op em vez de crashar).
 *
 * Constantes que precisam de valor primitivo (enums, IDs inválidos)
 * são exportadas como objetos reais sobrepondo o Proxy.
 *
 * Importante: este stub NUNCA é carregado em runtime Node — é apenas
 * o que o webpack escreve no bundle Edge. Tracing real continua
 * funcionando normalmente em rotas de API e workers (Node runtime),
 * onde `@opentelemetry/api` resolve pra package real do node_modules.
 */

/**
 * Factory de Proxy "deep no-op". Recebe uma `description` apenas pra
 * facilitar debug se algum dia precisarmos logar (com toString).
 */
function makeDeepProxy(description: string): unknown {
  // Função-base permite ser chamada (`fn(...)`); Proxy permite acessar
  // propriedades (`fn.x`). Combinando os dois, qualquer mistura de
  // `.x.y(...)` ou `.x(...).y` funciona.
  const target: (...args: unknown[]) => unknown = function () {
    return undefined;
  };
  // Anota nome pra `Function.prototype.toString` ficar útil em stack traces.
  Object.defineProperty(target, "name", {
    value: `edgeOtelStub:${description}`,
    configurable: true,
  });

  return new Proxy(target, {
    apply(_t, _thisArg, args) {
      // Última seção do path (ex.: "context.with" → "with").
      const lastSegment = description.split(".").pop() ?? "";

      // ===================================================================
      // APIs com semântica que NÃO pode ser no-op: callbacks que precisam
      // ser invocados para o caller obter um valor de retorno.
      // ===================================================================

      // `context.with(parent, fn, thisArg, ...args)` deve EXECUTAR fn e
      // retornar o valor que fn retornou. Sem isso, o middleware (que o
      // Next.js envolve em `context.with(...)` via auto-instrumentation)
      // recebe `undefined` em vez do `NextResponse` produzido — quebra com
      // "Expected an instance of Response to be returned".
      if (
        lastSegment === "with" &&
        args.length >= 2 &&
        typeof args[1] === "function"
      ) {
        const [, fn, thisArg, ...fnArgs] = args as [
          unknown,
          (...a: unknown[]) => unknown,
          unknown,
          ...unknown[],
        ];
        return Reflect.apply(fn, thisArg, fnArgs);
      }

      // `tracer.startActiveSpan(name, [opts], [ctx], fn)` deve invocar fn
      // passando um span no-op e retornar o valor de fn. Mesmo motivo:
      // Next.js usa isso para envelopar route handlers e middleware.
      if (lastSegment === "startActiveSpan") {
        const lastArg = args[args.length - 1];
        if (typeof lastArg === "function") {
          const noopSpan = makeDeepProxy(`${description}.span`);
          return (lastArg as (s: unknown) => unknown)(noopSpan);
        }
      }

      // `context.bind(ctx, target)` deve devolver o target (uma promise ou
      // função "envolvida" no contexto). Como não temos contexto real,
      // o target original é equivalente.
      if (lastSegment === "bind" && args.length >= 2) {
        return args[1];
      }

      // Demais chamadas → outro Proxy encadeável.
      return makeDeepProxy(`${description}()`);
    },
    construct(_target: object, _argArray: unknown[], _newTarget: unknown): object {
      return makeDeepProxy(`new ${description}`) as object;
    },
    get(_t, prop, _receiver) {
      // Symbol.toPrimitive / Symbol.iterator / etc → undefined evita
      // que o JS engine confunda o Proxy com algo iterável/numerável.
      if (typeof prop === "symbol") {
        if (prop === Symbol.toPrimitive) return () => `[edgeOtelStub:${description}]`;
        if (prop === Symbol.iterator) return undefined;
        return undefined;
      }
      // Casos especiais comuns:
      if (prop === "then") return undefined; // não é Promise
      if (prop === "default") return makeDeepProxy(`${description}.default`);
      if (prop === "name") return `edgeOtelStub:${description}`;
      if (prop === "length") return 0;
      if (prop === "toString") return () => `[edgeOtelStub:${description}]`;
      if (prop === "toJSON") return () => null;

      return makeDeepProxy(`${description}.${String(prop)}`);
    },
    has() {
      return true;
    },
  });
}

// =====================================================================
// Exports nomeados — TS precisa de tipos concretos (`any` no any-cast)
// pra que call-sites compile. Valores em runtime são todos Proxies.
// =====================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
export const trace: any = makeDeepProxy("trace");
export const metrics: any = makeDeepProxy("metrics");
export const context: any = makeDeepProxy("context");
export const propagation: any = makeDeepProxy("propagation");
export const diag: any = makeDeepProxy("diag");
export const baggage: any = makeDeepProxy("baggage");

// `createContextKey(description)` precisa de implementação real porque
// chamadores fazem `Symbol === Symbol` em maps; Proxy retornaria sempre
// um novo proxy diferente, quebrando lookup por chave.
export function createContextKey(description: string): symbol {
  return Symbol.for(`edge-otel-stub:${description}`);
}

// `ROOT_CONTEXT` precisa ter `setValue/getValue/deleteValue` que retornam
// outros contextos com setValue/getValue/.../ad infinitum. Proxy resolve.
export const ROOT_CONTEXT: any = makeDeepProxy("ROOT_CONTEXT");

// Enums — precisam ser objetos com chaves numéricas reais (não Proxy)
// pq o Next compara valores tipo `===`.
export const SpanStatusCode = Object.freeze({ UNSET: 0, OK: 1, ERROR: 2 } as const);
export const SpanKind = Object.freeze({
  INTERNAL: 0,
  SERVER: 1,
  CLIENT: 2,
  PRODUCER: 3,
  CONSUMER: 4,
} as const);
export const ValueType = Object.freeze({ INT: 0, DOUBLE: 1 } as const);
export const TraceFlags = Object.freeze({ NONE: 0, SAMPLED: 1 } as const);
export const DiagLogLevel = Object.freeze({
  NONE: 0,
  ERROR: 30,
  WARN: 50,
  INFO: 60,
  DEBUG: 70,
  VERBOSE: 80,
  ALL: 9999,
} as const);

export const INVALID_SPANID = "0000000000000000";
export const INVALID_TRACEID = "00000000000000000000000000000000";
export const INVALID_SPAN_CONTEXT = Object.freeze({
  traceId: INVALID_TRACEID,
  spanId: INVALID_SPANID,
  traceFlags: 0,
});

export function isValidTraceId(traceId: string): boolean {
  return typeof traceId === "string" && traceId.length === 32 && traceId !== INVALID_TRACEID;
}

export function isValidSpanId(spanId: string): boolean {
  return typeof spanId === "string" && spanId.length === 16 && spanId !== INVALID_SPANID;
}

export function isSpanContextValid(spanContext: { traceId?: string; spanId?: string } | undefined): boolean {
  if (!spanContext) return false;
  return isValidTraceId(spanContext.traceId ?? "") && isValidSpanId(spanContext.spanId ?? "");
}

export const defaultTextMapGetter = Object.freeze({
  get: (_carrier: Record<string, unknown>, _key: string) => undefined,
  keys: (_carrier: Record<string, unknown>) => [] as string[],
});

export const defaultTextMapSetter = Object.freeze({
  set: (_carrier: Record<string, unknown>, _key: string, _value: string) => {},
});

// Default export — alguns chamadores fazem `import otel from "@opentelemetry/api"`.
const otelStub: any = makeDeepProxy("default");
// Override propriedades importantes pra não retornar Proxy quando o
// usuário acessa enum constants via default.
Object.assign(otelStub, {
  trace,
  metrics,
  context,
  propagation,
  diag,
  baggage,
  createContextKey,
  ROOT_CONTEXT,
  SpanStatusCode,
  SpanKind,
  ValueType,
  TraceFlags,
  DiagLogLevel,
  INVALID_SPANID,
  INVALID_TRACEID,
  INVALID_SPAN_CONTEXT,
  isValidTraceId,
  isValidSpanId,
  isSpanContextValid,
  defaultTextMapGetter,
  defaultTextMapSetter,
});

export default otelStub;
