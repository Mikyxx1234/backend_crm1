/** Normaliza cabeçalhos CSV para chaves estáveis (snake_case). */
export function normalizeCsvHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
}

export type CsvDelimiter = "," | ";" | "\t";

/**
 * Parser CSV char-a-char (state machine). Suporta:
 *  - Delimitador configurável (",", ";", "\t")
 *  - Quebra de linha dentro de campos com aspas ("…\n…")
 *  - Escape de aspas duplas dentro de quoted (`""` => `"`)
 *  - BOM UTF-8 no início do arquivo
 *  - CRLF e LF
 */
export function parseCsv(
  text: string,
  delimiter: CsvDelimiter = ",",
): { headers: string[]; rows: Record<string, string>[] } {
  if (text.length === 0) return { headers: [], rows: [] };

  // Remove BOM
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++; // pular a segunda aspa
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    // fora de aspas
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") {
      // se vier \r\n, deixa o \n cuidar do encerramento
      if (src[i + 1] === "\n") continue;
      row.push(field);
      records.push(row);
      field = "";
      row = [];
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      records.push(row);
      field = "";
      row = [];
      continue;
    }
    field += ch;
  }

  // último campo/registro
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  // descartar linhas totalmente vazias
  const cleaned = records.filter((r) => r.some((c) => c.trim().length > 0));
  if (cleaned.length === 0) return { headers: [], rows: [] };

  const headerCells = cleaned[0].map(normalizeCsvHeader);
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < cleaned.length; r++) {
    const cells = cleaned[r];
    const obj: Record<string, string> = {};
    for (let c = 0; c < headerCells.length; c++) {
      obj[headerCells[c]] = (cells[c] ?? "").trim();
    }
    rows.push(obj);
  }

  return { headers: headerCells, rows };
}

/**
 * Mantida para compatibilidade. Não recomendada para parsing real
 * (não lida com newline em quoted). Usa o parser completo internamente.
 */
export function parseCsvLine(line: string, delimiter: CsvDelimiter = ","): string[] {
  const { rows } = parseCsv(`__h${delimiter}placeholder\n${line}`, delimiter);
  if (rows.length === 0) return [];
  const first = rows[0];
  return Object.values(first);
}

/**
 * Detecta heuristicamente o delimitador analisando a primeira linha de texto.
 * Conta ocorrências de ";", "," e "\t" e devolve o que mais aparece. Default: ",".
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = text.split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<CsvDelimiter, number> = {
    ",": 0,
    ";": 0,
    "\t": 0,
  };
  let inQuotes = false;
  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "," || ch === ";" || ch === "\t")) {
      counts[ch] += 1;
    }
  }
  const best = (Object.entries(counts) as [CsvDelimiter, number][]).sort(
    (a, b) => b[1] - a[1],
  )[0];
  return best[1] > 0 ? best[0] : ",";
}
