import { mkdir, writeFile } from "fs/promises";
import { NextResponse } from "next/server";
import path from "path";

import { auth } from "@/lib/auth";
import { requireConversationAccess } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";
import { sseBus } from "@/lib/sse-bus";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_RECORDING_BYTES = 64 * 1024 * 1024;
/** `audio/...` vindo do MediaRecorder do browser é o que aceitamos. */
const ALLOWED_MIME_PREFIX = "audio/";

function isFileLike(v: unknown): v is Blob & { name?: string } {
  return (
    v instanceof Blob ||
    (typeof v === "object" &&
      v !== null &&
      typeof (v as Blob).arrayBuffer === "function" &&
      typeof (v as Blob).size === "number")
  );
}

async function blobToBuffer(blob: Blob): Promise<Buffer> {
  return Buffer.from(await blob.arrayBuffer());
}

function safeStr(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function extFromMime(mime: string): string {
  const base = (mime.split(";")[0] || "").trim().toLowerCase();
  if (base === "audio/webm") return "webm";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/mpeg") return "mp3";
  return "webm";
}

/**
 * Recebe o blob de áudio gravado no browser do agente durante uma
 * WhatsApp outbound call. A Meta não grava chamadas do lado dela, então
 * este é o único caminho para ter gravação.
 *
 * O arquivo é salvo em `public/uploads/call-recordings/` e uma mensagem
 * `whatsapp_call_recording` é criada (ou atualizada, se já existir com
 * o mesmo `externalId`) na timeline da conversa. O `externalId` usa o
 * mesmo padrão `call_timeline:{callId}` que o webhook da Meta usaria —
 * mantém compat caso algum dia a Meta passe a enviar recording_url.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id } = await context.params;
    const denied = await requireConversationAccess(session, id);
    if (denied) return denied;

    const conv = await prisma.conversation.findUnique({
      where: { id },
      select: { id: true, contactId: true },
    });
    if (!conv) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch (err) {
      console.error("[call-recording] formData parse error:", err);
      return NextResponse.json({ message: "Upload inválido." }, { status: 400 });
    }

    const raw = form.get("file");
    if (!raw || !isFileLike(raw) || raw.size === 0) {
      return NextResponse.json({ message: "Gravação vazia." }, { status: 400 });
    }
    if (raw.size > MAX_RECORDING_BYTES) {
      return NextResponse.json(
        { message: "Gravação excede 64 MB." },
        { status: 413 },
      );
    }

    const rawMime = (raw.type || "").toLowerCase();
    // MediaRecorder eventualmente serializa sem MIME — aceita se o nome
    // indica áudio; caso contrário rejeita (evita upload acidental).
    if (rawMime && !rawMime.startsWith(ALLOWED_MIME_PREFIX)) {
      return NextResponse.json(
        { message: `MIME não suportado: ${rawMime}` },
        { status: 400 },
      );
    }

    const callId = safeStr(form.get("callId")) || null;
    const directionRaw = safeStr(form.get("direction"));
    const direction =
      directionRaw === "BUSINESS_INITIATED" || directionRaw === "USER_INITIATED"
        ? directionRaw
        : "BUSINESS_INITIATED";
    const startedAt = parseDate(safeStr(form.get("startedAt"))) ?? new Date();
    const endedAt = parseDate(safeStr(form.get("endedAt"))) ?? new Date();
    const durationSec = Math.max(
      0,
      Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
    );

    const ext = extFromMime(rawMime);
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const safeFileName = `call-${timestamp}-${rand}.${ext}`;

    let buffer: Buffer;
    try {
      buffer = await blobToBuffer(raw);
    } catch (err) {
      console.error("[call-recording] buffer read error:", err);
      return NextResponse.json(
        { message: "Falha ao ler arquivo." },
        { status: 500 },
      );
    }

    const dir = path.join(process.cwd(), "public", "uploads", "call-recordings");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, safeFileName), buffer);
    const publicUrl = `/uploads/call-recordings/${safeFileName}`;

    const agentName = session.user.name ?? session.user.email ?? "Agente";
    const senderName =
      direction === "BUSINESS_INITIATED"
        ? `WhatsApp · chamada · ${agentName}`
        : "WhatsApp · chamada";

    // Legenda enxuta (não confundir com o bloco verboso antigo do webhook).
    const hmS = new Intl.DateTimeFormat("pt-BR", {
      timeZone: process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    }).format(startedAt);
    const hmE = new Intl.DateTimeFormat("pt-BR", {
      timeZone: process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    }).format(endedAt);
    const durStr =
      durationSec >= 60
        ? `${Math.floor(durationSec / 60)}m${String(durationSec % 60).padStart(2, "0")}s`
        : `${durationSec}s`;
    const content = `Gravação da chamada · ${hmS}–${hmE} · ${durStr}`;

    const externalId = callId ? `call_timeline:${callId}` : null;

    // Lateralização da gravação acompanha o lado de quem iniciou a
    // chamada — se foi o agente (BUSINESS_INITIATED), bolha vai pra
    // direita. Antes era hardcoded `"in"` e a gravação aparecia à
    // esquerda mesmo pra chamadas outbound feitas pelo próprio agente.
    const recordingDirection: "in" | "out" =
      direction === "BUSINESS_INITIATED" ? "out" : "in";

    let msg;
    if (externalId) {
      const existing = await prisma.message.findFirst({
        where: { conversationId: conv.id, externalId },
        select: { id: true },
      });
      if (existing) {
        msg = await prisma.message.update({
          where: { id: existing.id },
          data: {
            content,
            mediaUrl: publicUrl,
            messageType: "whatsapp_call_recording",
            senderName,
            direction: recordingDirection,
          },
        });
      } else {
        msg = await prisma.message.create({
          data: {
            conversationId: conv.id,
            content,
            direction: recordingDirection,
            messageType: "whatsapp_call_recording",
            senderName,
            externalId,
            mediaUrl: publicUrl,
            createdAt: endedAt,
          },
        });
      }
    } else {
      msg = await prisma.message.create({
        data: {
          conversationId: conv.id,
          content,
          direction: recordingDirection,
          messageType: "whatsapp_call_recording",
          senderName,
          mediaUrl: publicUrl,
          createdAt: endedAt,
        },
      });
    }

    try {
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { updatedAt: new Date(), lastMessageDirection: recordingDirection },
      });
    } catch {
      /* ignore */
    }

    sseBus.publish("new_message", {
      conversationId: conv.id,
      contactId: conv.contactId,
      direction: recordingDirection,
      content,
      mediaUrl: publicUrl,
      messageType: "whatsapp_call_recording",
      timestamp: endedAt,
    });

    return NextResponse.json({
      ok: true,
      messageId: msg.id,
      mediaUrl: publicUrl,
      durationSec,
    });
  } catch (err) {
    console.error("[call-recording] fatal:", err);
    return NextResponse.json(
      { message: "Erro ao salvar gravação." },
      { status: 500 },
    );
  }
}
