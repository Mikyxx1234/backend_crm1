import { parseCsv, type CsvDelimiter, detectDelimiter } from "@/lib/csv-parse";
import { prisma } from "@/lib/prisma";

/**
 * Lê o conteúdo de um arquivo enviado via multipart e devolve headers + rows.
 * Suporta CSV (qualquer delimitador) e XLSX/XLS/ODS via SheetJS.
 *
 * @param file Arquivo recebido em FormData
 * @param explicitDelimiter Se informado, força o delimitador. Caso contrário, detecta.
 */
export async function readUploadedTable(
  file: File,
  explicitDelimiter?: CsvDelimiter,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const name = file.name.toLowerCase();
  const isSpreadsheet =
    name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".ods");

  if (isSpreadsheet) {
    const XLSX = await import("xlsx");
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) return { headers: [], rows: [] };
    const ws = wb.Sheets[firstSheetName];
    if (!ws) return { headers: [], rows: [] };

    const data = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false,
      defval: "",
    });
    if (data.length === 0) return { headers: [], rows: [] };

    const headerRow = (data[0] ?? []) as unknown[];
    const headers = headerRow.map((h) =>
      String(h ?? "").trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_"),
    );

    const rows: Record<string, string>[] = [];
    for (let r = 1; r < data.length; r++) {
      const arr = (data[r] ?? []) as unknown[];
      if (arr.every((v) => v === null || v === undefined || String(v).trim() === "")) continue;
      const obj: Record<string, string> = {};
      for (let c = 0; c < headers.length; c++) {
        obj[headers[c]] = String(arr[c] ?? "").trim();
      }
      rows.push(obj);
    }
    return { headers, rows };
  }

  const text = await file.text();
  const delimiter = explicitDelimiter ?? detectDelimiter(text);
  return parseCsv(text, delimiter);
}

/**
 * Faz upsert da Tag por (organizationId, name) e retorna o id.
 * Reutiliza a tag se já existir.
 */
export async function upsertImportTag(
  organizationId: string,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Nome da tag vazio.");
  const tag = await prisma.tag.upsert({
    where: { organizationId_name: { organizationId, name: trimmed } },
    update: {},
    create: { organizationId, name: trimmed },
    select: { id: true },
  });
  return tag.id;
}

/** Associa a tag ao contato. Idempotente. */
export async function attachTagToContact(contactId: string, tagId: string): Promise<void> {
  await prisma.tagOnContact.upsert({
    where: { contactId_tagId: { contactId, tagId } },
    update: {},
    create: { contactId, tagId },
  });
}

/** Associa a tag ao negócio. Idempotente. */
export async function attachTagToDeal(dealId: string, tagId: string): Promise<void> {
  await prisma.tagOnDeal.upsert({
    where: { dealId_tagId: { dealId, tagId } },
    update: {},
    create: { dealId, tagId },
  });
}

/**
 * Lê e valida o flag updateExisting de um FormData.
 * Default: true (compat com comportamento anterior).
 * Aceita: "false" / "0" / "no" => false. Resto => true.
 */
export function readUpdateExistingFlag(formData: FormData): boolean {
  const raw = formData.get("updateExisting");
  if (raw === null) return true;
  const s = String(raw).trim().toLowerCase();
  return !(s === "false" || s === "0" || s === "no");
}

/** Lê o delimitador opcional do FormData. */
export function readDelimiterFlag(formData: FormData): CsvDelimiter | undefined {
  const raw = formData.get("delimiter");
  if (raw === null) return undefined;
  const s = String(raw);
  if (s === "," || s === ";" || s === "\t") return s;
  return undefined;
}

/** Lê o nome da tag opcional do FormData. */
export function readTagFlag(formData: FormData): string | undefined {
  const raw = formData.get("tag");
  if (raw === null) return undefined;
  const s = String(raw).trim();
  return s.length > 0 ? s : undefined;
}
