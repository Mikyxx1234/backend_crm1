/**
 * Geração de CSV (counterpart do csv-parse.ts).
 *
 * Separador padrão: ponto e vírgula (`;`) — é o que o Excel em pt-BR espera
 * ao abrir o arquivo por clique duplo (evita jogar tudo numa coluna só ou
 * desalinhar colunas). O `csv-parse.ts` detecta o separador automaticamente
 * (`,`, `;` ou tab), então o round-trip export→import continua funcionando.
 *
 * Regras RFC 4180: célula é envolvida em aspas duplas quando contém o
 * separador ativo, aspas, quebra de linha, ou espaço nas bordas; aspas
 * internas são escapadas duplicando (`"` -> `""`). Linhas separadas por CRLF
 * (compat máxima com Excel). O BOM UTF-8 é responsabilidade de quem
 * serve/baixa o arquivo (a rota seta no início do corpo).
 */

/** Separador padrão dos exports — amigável ao Excel pt-BR. */
export const DEFAULT_CSV_DELIMITER = ";";

export function escapeCsvCell(
  value: unknown,
  delimiter: string = DEFAULT_CSV_DELIMITER,
): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  if (s.length === 0) return "";
  const needsQuote =
    s.includes(delimiter) || /["\n\r]/.test(s) || s !== s.trim();
  if (needsQuote) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Monta o CSV a partir de uma lista de cabeçalhos e linhas (cada linha é
 * um objeto chaveado pelos cabeçalhos). Valores ausentes viram célula
 * vazia. Mantém a ordem das colunas conforme `headers`. Separador padrão
 * `;` (ver `DEFAULT_CSV_DELIMITER`).
 */
export function toCsv(
  headers: string[],
  rows: ReadonlyArray<Record<string, unknown>>,
  delimiter: string = DEFAULT_CSV_DELIMITER,
): string {
  const headerLine = headers.map((h) => escapeCsvCell(h, delimiter)).join(delimiter);
  const lines = rows.map((row) =>
    headers.map((h) => escapeCsvCell(row[h], delimiter)).join(delimiter),
  );
  return [headerLine, ...lines].join("\r\n");
}

/** ISO 8601 (UTC) ou string vazia. Estável p/ reimportar e ordenar. */
export function csvDate(d: Date | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
