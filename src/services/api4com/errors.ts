/**
 * Erros tipados do cliente Api4com.
 *
 * Hierarquia:
 *   Api4ComError                  — base (HTTP genérico, rede, timeout)
 *     Api4ComAuthError            — 401/403 (token inválido/expirado)
 *     Api4ComValidationError      — 4xx com problema de payload
 *     Api4ComConflictError        — 409 ou validação que indica "já existe"
 *     Api4ComServerError          — 5xx após esgotar retries
 */

export class Api4ComError extends Error {
  readonly status?: number;
  readonly endpoint?: string;
  readonly responseBody?: string;

  constructor(
    message: string,
    opts: { status?: number; endpoint?: string; responseBody?: string } = {},
  ) {
    super(message);
    this.name = "Api4ComError";
    this.status = opts.status;
    this.endpoint = opts.endpoint;
    this.responseBody = opts.responseBody;
  }
}

export class Api4ComAuthError extends Api4ComError {
  constructor(message: string, opts: ConstructorParameters<typeof Api4ComError>[1] = {}) {
    super(message, opts);
    this.name = "Api4ComAuthError";
  }
}

export class Api4ComValidationError extends Api4ComError {
  constructor(message: string, opts: ConstructorParameters<typeof Api4ComError>[1] = {}) {
    super(message, opts);
    this.name = "Api4ComValidationError";
  }
}

export class Api4ComConflictError extends Api4ComError {
  constructor(message: string, opts: ConstructorParameters<typeof Api4ComError>[1] = {}) {
    super(message, opts);
    this.name = "Api4ComConflictError";
  }
}

export class Api4ComServerError extends Api4ComError {
  constructor(message: string, opts: ConstructorParameters<typeof Api4ComError>[1] = {}) {
    super(message, opts);
    this.name = "Api4ComServerError";
  }
}
