import { writeFile, mkdir } from "fs/promises";
import { NextResponse } from "next/server";
import path from "path";

import { auth } from "@/lib/auth";
import { requireConversationAccess } from "@/lib/conversation-access";
import {
  convertToOgg,
  guessInputExt,
  isValidOgg,
  needsVoiceConversion,
  mimeFromExtension,
} from "@/lib/audio-convert";
import { prisma } from "@/lib/prisma";
import { metaWhatsApp, formatMetaSendError } from "@/lib/meta-whatsapp/client";
import { sendWhatsAppMedia, isBaileysChannel } from "@/lib/send-whatsapp";
import { getConversationLite } from "@/services/conversations";
import { fireTrigger } from "@/services/automation-triggers";
import { cancelPendingForConversation } from "@/services/scheduled-messages";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_FILE_SIZE = 16 * 1024 * 1024;
const ALLOWED_PREFIXES = [
  "image/", "video/", "audio/",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
  "application/octet-stream",
  "text/plain", "text/csv",
];

function isFileLike(v: unknown): v is Blob & { name?: string } {
  return (
    v instanceof Blob ||
    (typeof v === "object" && v !== null && typeof (v as Blob).arrayBuffer === "function" && typeof (v as Blob).size === "number")
  );
}

async function blobToBuffer(blob: Blob): Promise<Buffer> {
  try {
    return Buffer.from(await blob.arrayBuffer());
  } catch {
    const reader = blob.stream().getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) parts.push(value);
    }
    return Buffer.concat(parts);
  }
}

function resolveMediaType(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/**
 * Derive a reliable MIME from both the raw blob type and filename extension.
 * Some browsers/runtimes lose the blob MIME during FormData transport.
 */
function resolveMime(rawType: string, fileName: string): string {
  const blobMime = rawType?.split(";")[0].trim();
  if (blobMime && blobMime !== "application/octet-stream") return blobMime;

  const ext = fileName.includes(".") ? fileName.split(".").pop()! : "";
  const fromExt = mimeFromExtension(ext);
  if (fromExt) return fromExt;

  return blobMime || "application/octet-stream";
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
    }

    const { id } = await context.params;
    const denied = await requireConversationAccess(session, id);
    if (denied) return denied;

    const conv = await getConversationLite(id);
    if (!conv) {
      return NextResponse.json({ message: "Conversa não encontrada." }, { status: 404 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch (err) {
      console.error("[attachments] formData parse error:", err);
      return NextResponse.json({ message: "Erro ao processar upload." }, { status: 400 });
    }

    const raw = form.get("file");
    const caption = (form.get("caption") as string) ?? "";

    if (!raw || !isFileLike(raw) || raw.size === 0) {
      return NextResponse.json({ message: "Nenhum arquivo enviado." }, { status: 400 });
    }

    if (raw.size > MAX_FILE_SIZE) {
      return NextResponse.json({ message: "Arquivo muito grande (máx 16 MB)." }, { status: 400 });
    }

    const senderName = session.user.name ?? session.user.email ?? "Agente";
    const timestamp = Date.now();
    const fileName = (raw as File).name || "file";

    const mimeBase = resolveMime(raw.type, fileName);

    if (!ALLOWED_PREFIXES.some((p) => mimeBase.startsWith(p))) {
      return NextResponse.json({ message: `Tipo não suportado: ${mimeBase}` }, { status: 400 });
    }

    const ext = fileName.includes(".") ? fileName.split(".").pop() : mimeBase.split("/").pop() ?? "bin";
    const safeFileName = `${timestamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    let buffer: Buffer;
    try {
      buffer = await blobToBuffer(raw);
    } catch (err) {
      console.error("[attachments] buffer read error:", err);
      return NextResponse.json({ message: "Erro ao ler arquivo." }, { status: 500 });
    }

    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, safeFileName), buffer);

    const publicUrl = `/uploads/${safeFileName}`;

    // ── Send via WhatsApp (Meta Cloud API or Baileys) ──

    const useBaileys = isBaileysChannel(conv.channelRef);

    let metaSendError: string | null = null;
    let externalId: string | null = null;

    if (useBaileys) {
      const mediaType = resolveMediaType(mimeBase);
      const msgRow = await prisma.message.create({
        data: {
          conversationId: conv.id,
          content: caption || `📎 ${fileName}`,
          direction: "out",
          messageType: mediaType,
          senderName,
          mediaUrl: publicUrl,
        },
      });
      const baileysResult = await sendWhatsAppMedia({
        conversationId: conv.id,
        contactId: conv.contactId,
        channelRef: conv.channelRef,
        messageId: msgRow.id,
        mediaUrl: publicUrl,
        messageType: mediaType,
        caption: caption || undefined,
        waJid: conv.waJid,
      });
      if (baileysResult.failed) metaSendError = baileysResult.error;

      try {
        await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            lastMessageDirection: "out",
            hasAgentReply: true,
            ...(metaSendError ? { hasError: true } : { hasError: false }),
          },
        });
      } catch { /* columns may not exist yet */ }

      fireTrigger("message_sent", {
        contactId: conv.contactId,
        data: { channel: "WhatsApp", content: caption || "[Anexo]" },
      }).catch((err) => console.warn("[automation trigger] message_sent:", err));

      cancelPendingForConversation(conv.id, "agent_reply").catch((err) =>
        console.warn(
          "[scheduled-messages] falha ao cancelar apos envio de anexo (baileys):",
          err,
        ),
      );

      return NextResponse.json({
        message: {
          id: msgRow.id,
          content: caption || `📎 ${fileName}`,
          createdAt: msgRow.createdAt.toISOString(),
          direction: "out",
          messageType: mediaType,
          senderName,
          mediaUrl: publicUrl,
          sendStatus: metaSendError ? "failed" : "sent",
        },
      }, { status: 201 });
    }

    const contact = await prisma.contact.findUnique({
      where: { id: conv.contactId },
      select: { phone: true, whatsappBsuid: true },
    });
    const digits = contact?.phone?.replace(/\D/g, "") ?? "";
    const to = digits.length >= 8 ? digits : undefined;
    const recipient = contact?.whatsappBsuid?.trim() || undefined;

    if (metaWhatsApp.configured && (to || recipient)) {
      try {
        const mediaType = resolveMediaType(mimeBase);
        const isAudioType = mediaType === "audio";

        let uploadBuffer = buffer;
        let uploadMime = mimeBase;
        let uploadName = fileName;
        let sendAsVoice = false;

        if (isAudioType && needsVoiceConversion(mimeBase)) {
          const inputExt = guessInputExt(mimeBase);
          console.log(`[meta-attach] PTT requer OGG/Opus. Convertendo ${mimeBase} (.${inputExt}) -> audio/ogg via FFmpeg`);

          const converted = await convertToOgg(buffer, inputExt);
          if (converted && isValidOgg(converted)) {
            uploadBuffer = converted;
            uploadMime = "audio/ogg";
            uploadName = uploadName.replace(/\.[^.]+$/, ".ogg");
            if (!uploadName.endsWith(".ogg")) uploadName += ".ogg";
            sendAsVoice = true;
            console.log(`[meta-attach] Conversao OK, ${buffer.length} -> ${uploadBuffer.length} bytes | voice=true`);
          } else {
            sendAsVoice = false;
            console.error("[meta-attach] FALHA na conversao FFmpeg. Enviando audio REGULAR (sem voice flag) para garantir entrega.");
          }
        } else if (isAudioType && !needsVoiceConversion(mimeBase)) {
          sendAsVoice = true;
          console.log("[meta-attach] Audio ja em OGG/Opus, enviando como PTT | voice=true");
        }

        const mediaId = await metaWhatsApp.uploadMedia(uploadBuffer, uploadMime, uploadName);

        const result = await metaWhatsApp.sendMediaById(
          to,
          mediaId,
          mediaType,
          mediaType !== "audio" ? caption || undefined : undefined,
          mediaType === "document" ? fileName : undefined,
          sendAsVoice,
          recipient,
        );

        externalId = result.messages?.[0]?.id ?? null;
        console.log(
          `[meta-attach] Enviado ${mediaType} (${to ?? "—"}/${recipient ?? "—"}) | mime=${uploadMime} | mediaId=${mediaId} | wamid=${externalId} | voice=${sendAsVoice}`
        );
      } catch (err) {
        const errMsg = formatMetaSendError(err);
        console.error("[meta-attach] Falha ao enviar para Meta:", errMsg);
        metaSendError = errMsg;
      }
    } else if (!metaWhatsApp.configured) {
      console.warn("[meta-attach] Meta API nao configurada, midia salva apenas localmente");
    } else if (!to && !recipient) {
      console.warn("[meta-attach] Contato sem telefone nem BSUID WhatsApp");
    }

    const mediaType = resolveMediaType(mimeBase);
    const isAudioFile = mediaType === "audio";
    const displayContent = caption || (isAudioFile ? "" : `📎 ${fileName}`);

    await prisma.message.create({
      data: {
        conversationId: conv.id,
        content: displayContent,
        direction: "out",
        messageType: mediaType,
        senderName,
        mediaUrl: publicUrl,
        ...(externalId ? { externalId } : {}),
        ...(metaSendError ? { sendStatus: "failed", sendError: metaSendError } : {}),
      },
    });

    try {
      await prisma.conversation.update({
        where: { id: conv.id },
        data: {
          lastMessageDirection: "out",
          hasAgentReply: true,
          ...(metaSendError ? { hasError: true } : { hasError: false }),
        },
      });
    } catch { /* columns may not exist yet */ }

    fireTrigger("message_sent", {
      contactId: conv.contactId,
      data: { channel: "WhatsApp", content: displayContent || "[Anexo]" },
    }).catch((err) => console.warn("[automation trigger] message_sent:", err));

    cancelPendingForConversation(conv.id, "agent_reply").catch((err) =>
      console.warn(
        "[scheduled-messages] falha ao cancelar apos envio de anexo:",
        err,
      ),
    );

    return NextResponse.json({
      message: {
        id: `att-${timestamp}`,
        content: displayContent,
        createdAt: new Date().toISOString(),
        direction: "out",
        messageType: mediaType,
        senderName,
        mediaUrl: publicUrl,
      },
      ...(metaSendError ? { metaError: metaSendError } : {}),
    }, { status: 201 });
  } catch (e: unknown) {
    console.error("[attachments] Unhandled error:", e);
    const msg = e instanceof Error ? e.message : "Erro ao enviar anexo.";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
