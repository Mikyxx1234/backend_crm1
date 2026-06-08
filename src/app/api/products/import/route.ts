import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { parseCsv } from "@/lib/csv-parse";
import { assertImportPermission } from "@/lib/import-guard";
import { prisma } from "@/lib/prisma";
import { withOrgFromCtx } from "@/lib/prisma-helpers";

function parseBool(v: string | undefined, fallback = false): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (s === "") return fallback;
  return s === "true" || s === "1" || s === "sim" || s === "yes";
}

function parseNum(v: string | undefined, fallback = 0): number {
  if (v == null || v.trim() === "") return fallback;
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function parseOptionalNum(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseAttributes(v: string | undefined): Prisma.InputJsonValue | null {
  if (v == null || v.trim() === "") return null;
  try {
    return JSON.parse(v) as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

/**
 * POST /api/products/import (multipart/form-data, campo "file")
 *
 * Importa/atualiza o catálogo de produtos via CSV. Upsert por:
 *   1. `id` (se presente e existir) → atualiza
 *   2. `sku` (se presente e existir na org) → atualiza
 *   3. caso contrário → cria (exige `name`)
 *
 * Colunas reconhecidas: id, sku, name, description, type, price, unit,
 * is_active, track_stock, stock, e `cf_<slug>` para campos personalizados
 * (entity=product). Formato compatível com `/api/products/export`.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    const denied = await assertImportPermission(session, "product");
    if (denied) return denied;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { message: "Envie o arquivo CSV no campo \"file\" (multipart/form-data)." },
        { status: 400 },
      );
    }

    const text = await file.text();
    const { headers, rows } = parseCsv(text);

    if (headers.length === 0) {
      return NextResponse.json({ message: "CSV vazio ou inválido." }, { status: 400 });
    }
    if (!headers.includes("name") && !headers.includes("sku") && !headers.includes("id")) {
      return NextResponse.json(
        { message: "CSV inválido: inclua ao menos uma coluna \"name\", \"sku\" ou \"id\"." },
        { status: 400 },
      );
    }

    // Mapa de campos personalizados de produto: slug -> id.
    const cfDefs = await prisma.customField.findMany({
      where: { entity: "product" },
      select: { id: true, name: true },
    });
    const cfByName = new Map(cfDefs.map((f) => [f.name, f.id]));

    const failed: { row: number; message: string }[] = [];
    let created = 0;
    let updated = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;

      const id = row.id?.trim() || "";
      const sku = row.sku?.trim() || "";
      const name = row.name?.trim() || "";

      // Resolve alvo do upsert.
      let targetId: string | null = null;
      try {
        if (id) {
          const found = await prisma.product.findFirst({ where: { id }, select: { id: true } });
          if (found) targetId = found.id;
        }
        if (!targetId && sku) {
          const found = await prisma.product.findFirst({ where: { sku }, select: { id: true } });
          if (found) targetId = found.id;
        }
      } catch {
        failed.push({ row: rowNumber, message: "Erro ao localizar produto existente." });
        continue;
      }

      const rawType = row.type?.trim().toUpperCase();
      const type = rawType === "SERVICE" ? "SERVICE" : rawType === "PRODUCT" ? "PRODUCT" : undefined;

      try {
        let productId: string;

        if (targetId) {
          // UPDATE — só aplica colunas presentes no CSV.
          const data: Record<string, unknown> = {};
          if (name) data.name = name;
          if ("description" in row) data.description = row.description?.trim() || null;
          if ("sku" in row) data.sku = sku || null;
          if ("price" in row) data.price = parseNum(row.price);
          if ("unit" in row) data.unit = row.unit?.trim() || "un";
          if ("is_active" in row) data.isActive = parseBool(row.is_active, true);
          if (type) data.type = type;
          const effType = type ?? undefined;
          if ("track_stock" in row) {
            const track = parseBool(row.track_stock);
            data.trackStock = effType === "SERVICE" ? false : track;
          }
          if ("stock" in row) data.stock = parseNum(row.stock);
          // Novos campos do Modulo Catalogo Comercial (aditivos):
          if ("code" in row) data.code = row.code?.trim() || null;
          if ("discount_max" in row) data.discountMax = parseOptionalNum(row.discount_max);
          if ("discount_requires_approval" in row) {
            data.discountRequiresApproval = parseBool(row.discount_requires_approval);
          }
          if ("stock_alert_at" in row) data.stockAlertAt = parseOptionalNum(row.stock_alert_at);
          if ("attributes" in row) {
            const attrs = parseAttributes(row.attributes);
            data.attributes = attrs === null ? Prisma.JsonNull : attrs;
          }
          if (data.type === "SERVICE") {
            data.trackStock = false;
            data.stock = 0;
          }
          const up = await prisma.product.update({ where: { id: targetId }, data });
          productId = up.id;
          updated += 1;
        } else {
          // CREATE — exige name.
          if (!name) {
            failed.push({ row: rowNumber, message: "Sem produto correspondente e sem \"name\" para criar." });
            continue;
          }
          const finalType = type ?? "PRODUCT";
          const track = finalType === "SERVICE" ? false : parseBool(row.track_stock);
          const attrs = parseAttributes(row.attributes);
          const cr = await prisma.product.create({
            data: withOrgFromCtx({
              name,
              description: row.description?.trim() || null,
              sku: sku || null,
              price: parseNum(row.price),
              unit: finalType === "SERVICE" ? "serviço" : (row.unit?.trim() || "un"),
              type: finalType,
              isActive: parseBool(row.is_active, true),
              trackStock: track,
              stock: track ? parseNum(row.stock) : 0,
              code: row.code?.trim() || null,
              discountMax: parseOptionalNum(row.discount_max),
              discountRequiresApproval: parseBool(row.discount_requires_approval),
              stockAlertAt: parseOptionalNum(row.stock_alert_at),
              attributes: attrs === null ? Prisma.JsonNull : attrs,
            }),
          });
          productId = cr.id;
          created += 1;
        }

        // Campos personalizados (cf_<slug>).
        for (const [slug, fieldId] of cfByName) {
          const col = `cf_${slug}`;
          if (!(col in row)) continue;
          const value = (row[col] ?? "").trim();
          if (value) {
            await prisma.productCustomFieldValue.upsert({
              where: { productId_customFieldId: { productId, customFieldId: fieldId } },
              update: { value },
              create: withOrgFromCtx({ productId, customFieldId: fieldId, value }),
            });
          } else {
            await prisma.productCustomFieldValue.deleteMany({
              where: { productId, customFieldId: fieldId },
            });
          }
        }
      } catch (e: unknown) {
        const code =
          typeof e === "object" && e !== null && "code" in e
            ? String((e as { code: string }).code)
            : "";
        const msg =
          code === "P2002"
            ? "SKU duplicado nesta organização."
            : "Erro ao salvar produto.";
        failed.push({ row: rowNumber, message: msg });
      }
    }

    return NextResponse.json(
      { created, updated, failed, totalRows: rows.length },
      { status: 201 },
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao importar produtos." }, { status: 500 });
  }
}
