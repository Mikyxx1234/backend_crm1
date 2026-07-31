/**
 * Validação comum de período para as APIs de "Uso do sistema".
 *
 * Regras:
 *   - `from` e `to` obrigatórios em ISO 8601;
 *   - `from < to`;
 *   - janela máxima: 366 dias.
 */

const MAX_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;

export type PeriodResult =
  | { ok: true; from: Date; to: Date }
  | { ok: false; message: string };

export function parsePeriod(searchParams: URLSearchParams): PeriodResult {
  const fromS = searchParams.get("from");
  const toS = searchParams.get("to");
  if (!fromS || !toS) {
    return {
      ok: false,
      message: "Parâmetros from e to são obrigatórios (ISO).",
    };
  }
  const from = new Date(fromS);
  const to = new Date(toS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { ok: false, message: "from/to devem ser datas ISO válidas." };
  }
  if (from.getTime() >= to.getTime()) {
    return { ok: false, message: "from deve ser anterior a to." };
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_MS) {
    return { ok: false, message: "Janela máxima suportada é de 366 dias." };
  }
  return { ok: true, from, to };
}
