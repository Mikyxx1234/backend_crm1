import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/authz/resource-policy";
import {
  resolveImportModeFlags,
  validateDealImportHeaders,
  type DealImportMode,
} from "@/lib/deal-import-core";
import { assertImportPermission } from "@/lib/import-guard";
import {
  readDelimiterFlag,
  readImportModeFlag,
  readTagFlag,
  readUpdateExistingFlag,
  readUploadedTable,
} from "@/lib/import-helpers";
import { prisma } from "@/lib/prisma";
import { IMPORT_ETL_JOB_NAMES, enqueueImportEtl } from "@/lib/queue";
import { enterRequestContext } from "@/lib/request-context";
import { generateFileName, saveFile } from "@/lib/storage/local";

/**
 * Importação de NEGÓCIOS (deals) — fluxo ASSÍNCRONO (ETL worker).
 *
 * Antes esta rota processava o arquivo inteiro de forma síncrona dentro do
 * request HTTP — com bases grandes (10k+ linhas) e DB remoto isso estourava o
 * timeout do proxy (~30s). Agora, igual à importação de contatos:
 *   1. valida permissão + parseia para validar cabeçalho e contar linhas;
 *   2. salva o arquivo no bucket `imports` do storage compartilhado + embute
 *      o conteúdo em base64 no BulkOperation (worker lê do próprio banco);
 *   3. cria um `BulkOperation` DEAL_IMPORT PENDING (fonte da verdade do progresso);
 *   4. enfileira o job `deal-import` e responde 202 { operationId };
 *   5. o etl-worker processa em LOTE (createMany), suportando bases grandes.
 *
 * O frontend acompanha via GET /api/bulk-operations/[id] (barra de progresso).
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    const denied = assertImportPermission(session);
    if (denied) return denied;

    if (session?.user?.organizationId) {
      enterRequestContext({
        organizationId: session.user.organizationId,
        userId: session.user.id,
        isSuperAdmin: Boolean(session.user.isSuperAdmin),
        actor: {
          type: "HUMAN",
          label: session.user.name ?? session.user.email ?? session.user.id,
          sublabel: "Importação",
        },
      });
    }

    const permissionDenied = await requirePermissionForUser(
      (session?.user ?? {}) as {
        id: string;
        organizationId: string | null;
        role?: string | null;
        isSuperAdmin?: boolean;
      },
      "deal:create",
    );
    if (permissionDenied) return permissionDenied;

    if (!session?.user?.organizationId) {
      return NextResponse.json({ message: "Sessão sem organização." }, { status: 401 });
    }
    const organizationId = session.user.organizationId;
    const userId = session.user.id;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { message: 'Envie o arquivo CSV no campo "file" (multipart/form-data).' },
        { status: 400 },
      );
    }

    const delimiter = readDelimiterFlag(formData);
    const updateExisting = readUpdateExistingFlag(formData);
    const tagName = readTagFlag(formData);

    // Modo efetivo: quando o cliente não envia `importMode`, deriva do flag
    // legado `updateExisting` (updateExisting=true → upsert; false → só criar).
    const rawMode = readImportModeFlag(formData);
    const importMode: DealImportMode = rawMode ?? (updateExisting ? "upsert" : "create");
    const { allowCreate } = resolveImportModeFlags(importMode, updateExisting);

    // Parseia uma vez para validar o cabeçalho e contar linhas (total do
    // BulkOperation). O worker re-parseia o arquivo salvo.
    const { headers, rows } = await readUploadedTable(file, delimiter);

    const headerError = validateDealImportHeaders(headers, allowCreate);
    if (headerError) {
      return NextResponse.json({ message: headerError }, { status: 400 });
    }
    if (rows.length === 0) {
      return NextResponse.json(
        { message: "Arquivo sem linhas de dados." },
        { status: 400 },
      );
    }

    const ext = file.name.toLowerCase().endsWith(".xlsx")
      ? "xlsx"
      : file.name.toLowerCase().endsWith(".xls")
        ? "xls"
        : file.name.toLowerCase().endsWith(".ods")
          ? "ods"
          : "csv";
    const fileName = generateFileName({ prefix: "deals", ext });
    const buffer = Buffer.from(await file.arrayBuffer());
    await saveFile({ orgId: organizationId, bucket: "imports", fileName, buffer });

    const operation = await prisma.bulkOperation.create({
      data: {
        type: "DEAL_IMPORT",
        status: "PENDING",
        total: rows.length,
        payload: {
          fileName,
          originalName: file.name,
          importMode,
          fileContentB64: buffer.toString("base64"),
          ...(delimiter ? { delimiter } : {}),
          ...(tagName ? { tagName } : {}),
        },
        createdById: userId,
      },
      select: { id: true },
    });

    const job = await enqueueImportEtl(IMPORT_ETL_JOB_NAMES.dealImport, {
      operationId: operation.id,
      organizationId,
      initiatedByUserId: userId,
      fileName,
      originalName: file.name,
      delimiter,
      importMode,
      tagName,
    });

    if (!job) {
      await prisma.bulkOperation.update({
        where: { id: operation.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errors: [
            {
              itemId: "__operation__",
              message: "Fila de jobs indisponível (Redis offline)",
              attempt: 0,
              at: new Date().toISOString(),
            },
          ],
        },
      });
      return NextResponse.json(
        { message: "Fila de importação indisponível.", operationId: operation.id },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        message: "Importação enfileirada.",
        operationId: operation.id,
        total: rows.length,
      },
      { status: 202 },
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ message: "Erro ao importar negócios." }, { status: 500 });
  }
}
