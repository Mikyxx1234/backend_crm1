/** Normaliza cabeçalhos CSV para chaves estáveis (snake_case). */
export function normalizeCsvHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
}

function unquoteCell(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/""/g, '"').trim();
  }
  return s;
}

export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      values.push(unquoteCell(current));
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(unquoteCell(current));
  return values;
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headerCells = parseCsvLine(lines[0]).map(normalizeCsvHeader);
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < lines.length; r++) {
    const cells = parseCsvLine(lines[r]);
    const row: Record<string, string> = {};
    for (let c = 0; c < headerCells.length; c++) {
      row[headerCells[c]] = cells[c] ?? "";
    }
    rows.push(row);
  }

  return { headers: headerCells, rows };
}
