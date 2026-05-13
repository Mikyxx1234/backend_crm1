import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { parseCsv } from "@/lib/csv-parse";
import { assertImportPermission } from "@/lib/import-guard";
import { prisma } from "@/lib/prisma";
import { createDeal, isValidDealStatus, updateDeal } from "@/services/deals";

function hasColumn(headers: string[], ...names: string[]) {
  return names.some((n) => headers.includes(n));
}

function pickDealExternalId(
  headers: string[],
  row: Record<string, string>,
): string | null | undefined {
  if (!hasColumn(headers, "external_id", "externalid", "kommo_lead_id", "lead_external_id")) {
    return undefined;
  }
  const v =
    row.external_id?.trim() ||
    row.externalid?.trim() ||
    row.kommo_lead_id?.trim() ||
    row.lead_external_id?.trim() ||
    "";
  return v === "" ? null : v;
}

async function resolveOwnerId(row: Record<string, string>): Promise<string | undefined> {
  const id = row.owner_id?.trim() || row.ownertoid?.trim();
  if (id) return id;

  const emailRaw = row.owner_email?.trim() || row.owneremail?.trim();
  if (!emailRaw) return undefined;
  const u = await prisma.user.findFirst({
    where: { email: { equals: emailRaw.toLowerCase(), mode: "insensitive" } },
    select: { id: true },
  });
  return u?.id;
}

async function resolveStageId(row: Record<string, string>): Promise<string | null> {
  const sid = row.stage_id?.trim() || row.stageid?.trim();
  if (sid) {
    const s = await prisma.stage.findUnique({ where: { id: sid }, select: { id: true } });
    return s?.id ?? null;
  }

  const pn = row.pipeline_name?.trim() || row.pipeline?.trim();
  const sn = row.stage_name?.trim() || row.stage?.trim();
  if (pn && sn) {
    const stage = await prisma.stage.findFirst({
      where: {
        name: { equals: sn, mode: "insensitive" },
        pipeline: { name: { equals: pn, mode: "insensitive" } },
      },
      select: { id: true },
    });
    return stage?.id ?? null;
  }

  return null;
}

async function resolveContactIdForDeal(row: Record<string, string>): Promise<string | undefined> {
  const cid = row.contact_id?.trim() || row.contactid?.trim();
  if (cid) {
    const c = await prisma.contact.findUnique({ where: { id: cid }, select: { id: true } });
    if (c) return c.id;
  }

  const ext =
    row.contact_external_id?.trim() ||
    row.contact_externalid?.trim() ||
    row.kommo_contact_id?.trim();
  if (ext) {
    const c = await prisma.contact.findUnique({ where: { externalId: ext }, select: { id: true } });
    return c?.id;
  }

  return undefined;
}

type DealUpsert =
  | { mode: "update"; id: string }
  | { mode: "create"; id?: string; externalId?: string | null };

async function resolveDealUpsert(row: Record<string, string>): Promise<
  | { ok: true; target: DealUpsert }
  | { ok: false; message: string }
> {
  const id = row.id?.trim();
  const ext =
    row.external_id?.trim() ||
    row.externalid?.trim() ||
    row.kommo_lead_id?.trim() ||
    row.lead_external_id?.trim();
  const numRaw = row.deal_number?.trim();

  const candidates: { id: string }[] = [];

  if (id) {
    const d = await prisma.deal.findUnique({ where: { id }, select: { id: true } });
    if (d) candidates.push(d);
  }
  if (ext) {
    const d = await prisma.deal.findUnique({ where: { externalId: ext }, select: { id: true } });
    if (d) candidates.push(d);
  }
  if (numRaw && /^\d+$/.test(numRaw)) {
    const d = await prisma.deal.findUnique({
      where: { number: parseInt(numRaw, 10) },
      select: { id: true },
    });
    if (d) candidates.push(d);
  }

  const unique = [...new Set(candidates.map((c) => c.id))];
  if (unique.length > 1) {
    return {
      ok: false,
      message: "id, external_id e/ou deal_number apontam para negócios diferentes.",
    };
  }
  if (unique.length === 1) {
    return { ok: true, target: { mode: "update", id: unique[0] } };
  }

  return {
    ok: true,
    target: {
      mode: "create",
      ...(id ? { id } : {}),
      ...(ext ? { externalId: ext } : {}),
    },
  };
}

function parseExpectedClose(raw: string | undefined): Date | null | undefined {
  if (!raw?.trim()) return undefined;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    const denied = assertImportPermission(session);
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

    if (headers.length === 0 || !headers.includes("title")) {
      return NextResponse.json(
        {
          message:
            "CSV inválido: coluna \"title\" obrigatória. Informe \"stage_id\" ou \"pipeline_name\" + \"stage_name\".",
        },
        { status: 400 },
      );
    }

    const hasStage = headers.includes("stage_id") || headers.includes("stageid");
    const hasPipelineStage =
      (headers.includes("pipeline_name") || headers.includes("pipeline")) &&
      (headers.includes("stage_name") || headers.includes("stage"));

    if (!hasStage && !hasPipelineStage) {
      return NextResponse.json(
        {
          message:
            "Inclua \"stage_id\" (recomendado) ou o par \"pipeline_name\" + \"stage_name\" para localizar o estágio.",
        },
        { status: 400 },
      );
    }

    const failed: { row: number; message: string }[] = [];
    let created = 0;
    let updated = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;

      const title = row.title?.trim();
      if (!title) {
        failed.push({ row: rowNumber, message: "Título vazio." });
        continue;
      }

      const stageId = await resolveStageId(row);
      if (!stageId) {
        failed.push({ row: rowNumber, message: "Estágio não encontrado (stage_id ou pipeline+estágio)." });
        continue;
      }

      const statusRaw = row.status?.trim()?.toUpperCase();
      if (statusRaw && !isValidDealStatus(statusRaw)) {
        failed.push({ row: rowNumber, message: "status inválido (OPEN, WON, LOST)." });
        continue;
      }

      let value: number | undefined;
      const valRaw = row.value?.trim();
      if (valRaw) {
        const n = Number.parseFloat(valRaw.replace(",", "."));
        if (!Number.isFinite(n)) {
          failed.push({ row: rowNumber, message: "value inválido." });
          continue;
        }
        value = n;
      }

      const expectedClose = parseExpectedClose(row.expected_close?.trim() || row.expectedclose?.trim());
      if (expectedClose === null) {
        failed.push({ row: rowNumber, message: "expected_close inválido." });
        continue;
      }

      let ownerId: string | undefined;
      try {
        ownerId = await resolveOwnerId(row);
      } catch {
        failed.push({ row: rowNumber, message: "Erro ao resolver proprietário." });
        continue;
      }

      let contactId: string | undefined;
      try {
        contactId = await resolveContactIdForDeal(row);
      } catch {
        failed.push({ row: rowNumber, message: "Erro ao resolver contato." });
        continue;
      }

      const resolved = await resolveDealUpsert(row);
      if (!resolved.ok) {
        failed.push({ row: rowNumber, message: resolved.message });
        continue;
      }

      const externalPatch = pickDealExternalId(headers, row);

      const lostReason = row.lost_reason?.trim() || row.lostreason?.trim() || undefined;

      try {
        if (resolved.target.mode === "update") {
          await updateDeal(resolved.target.id, {
            title,
            stageId,
            ...(value !== undefined ? { value } : {}),
            ...(statusRaw && isValidDealStatus(statusRaw) ? { status: statusRaw } : {}),
            ...(expectedClose !== undefined ? { expectedClose } : {}),
            ...(lostReason !== undefined ? { lostReason } : {}),
            ...(contactId !== undefined ? { contactId } : {}),
            ...(ownerId !== undefined ? { ownerId } : {}),
            ...(externalPatch !== undefined ? { externalId: externalPatch } : {}),
          });
          updated += 1;
        } else {
          let externalForCreate: string | null | undefined = undefined;
          if (externalPatch !== undefined) {
            externalForCreate = externalPatch;
          } else if (resolved.target.externalId !== undefined) {
            externalForCreate = resolved.target.externalId;
          }
          await createDeal({
            ...(resolved.target.id ? { id: resolved.target.id } : {}),
            externalId: externalForCreate === undefined ? undefined : externalForCreate,
            title,
            stageId,
            value,
            status: statusRaw && isValidDealStatus(statusRaw) ? statusRaw : undefined,
            expectedClose,
            lostReason,
            contactId: contactId ?? undefined,
            ownerId,
          });
          created += 1;
        }
      } catch (e: unknown) {
        const code =
          typeof e === "object" && e !== null && "code" in e
            ? String((e as { code: string }).code)
            : "";
        const msg =
          e instanceof Error && e.message === "INVALID_TITLE"
            ? "Título inválido."
            : code === "P2002"
              ? "Violação de unicidade (id externo ou número duplicado)."
              : code === "P2003"
                ? "Referência inválida (contato, estágio ou usuário)."
                : "Erro ao salvar negócio.";
        failed.push({ row: rowNumber, message: msg });
      }
    }

    return NextResponse.json(
      {
        created,
        updated,
        failed,
        totalRows: rows.length,
      },
      { status: 201 },
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao importar negócios." }, { status: 500 });
  }
}
