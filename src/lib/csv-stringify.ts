/**
 * Geração de CSV (counterpart do csv-parse.ts).
 *
 * Regras RFC 4180: célula é envolvida em aspas duplas quando contém
 * vírgula, aspas, quebra de linha, ou espaço nas bordas; aspas internas
 * são escapadas duplicando (`"` -> `""`). Linhas separadas por CRLF
 * (compat máxima com Excel). O BOM UTF-8 é responsabilidade de quem
 * serve/baixa o arquivo (a rota seta no início do corpo).
 */

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  if (s.length === 0) return "";
  const needsQuote = /[",\n\r]/.test(s) || s !== s.trim();
  if (needsQuote) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Monta o CSV a partir de uma lista de cabeçalhos e linhas (cada linha é
 * um objeto chaveado pelos cabeçalhos). Valores ausentes viram célula
 * vazia. Mantém a ordem das colunas conforme `headers`.
 */
export function toCsv(
  headers: string[],
  rows: ReadonlyArray<Record<string, unknown>>,
): string {
  const headerLine = headers.map(escapeCsvCell).join(",");
  const lines = rows.map((row) =>
    headers.map((h) => escapeCsvCell(row[h])).join(","),
  );
  return [headerLine, ...lines].join("\r\n");
}

/** ISO 8601 (UTC) ou string vazia. Estável p/ reimportar e ordenar. */
export function csvDate(d: Date | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
