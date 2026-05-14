import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type BaileysEventMap,
  type AnyMessageContent,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { Prisma } from "@prisma/client";
import QRCode from "qrcode";

import { prisma } from "@/lib/prisma";
import { sseBus } from "@/lib/sse-bus";
import { usePostgresAuthState } from "./auth-state-postgres";
import { handleBaileysMessage } from "./message-handler";
import { registerLidMapping, getMapSize, clearChannelMap, loadPersistedMappings, fixLidContacts } from "./lid-resolver";

const RECONNECT_MAX_RETRIES = 8;
const RECONNECT_BASE_DELAY_MS = 2_000;
const QR_TIMEOUT_MS = 60_000;

export class BaileysSession {
  channelId: string;
  socket: WASocket | null = null;
  private retryCount = 0;
  private qrTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(channelId: string) {
    this.channelId = channelId;
  }

  async connect(): Promise<void> {
    if (this.destroyed) return;

    const loaded = await loadPersistedMappings(this.channelId);
    if (loaded > 0) {
      console.info(`[baileys:${this.channelId}] carregou ${loaded} mapeamentos LID→phone do banco`);
    }

    const { state, saveCreds } = await usePostgresAuthState(this.channelId);

    let version: [number, number, number] | undefined;
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest.version;
      console.info(`[baileys:${this.channelId}] usando versão WA ${version.join(".")}`);
    } catch {
      version = [2, 3000, 1034074495];
      console.warn(`[baileys:${this.channelId}] fallback para versão ${version.join(".")}`);
    }

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys),
      },
      version,
      printQRInTerminal: false,
      browser: ["CRM Eduit", "Chrome", "4.0.0"],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });

    this.socket = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      void this.handleConnectionUpdate(update);
    });

    sock.ev.on("contacts.upsert", (contacts) => {
      let newMappings = 0;
      for (const c of contacts as Array<{ id?: string; lid?: string }>) {
        if (c.lid && c.id && c.id.endsWith("@s.whatsapp.net")) {
          registerLidMapping(this.channelId, c.lid, c.id);
          newMappings++;
        }
      }
      console.info(
        `[baileys:${this.channelId}] contacts.upsert: ${contacts.length} contatos, ${newMappings} LIDs mapeados (total ${getMapSize(this.channelId)})`,
      );
      if (newMappings > 0) {
        fixLidContacts(this.channelId).then((fixed) => {
          if (fixed > 0) console.info(`[baileys:${this.channelId}] ${fixed} contatos com LID corrigidos`);
        }).catch(() => {});
      }
    });

    sock.ev.on("contacts.update", (updates) => {
      for (const c of updates as Array<{ id?: string; lid?: string }>) {
        if (c.lid && c.id && c.id.endsWith("@s.whatsapp.net")) {
          registerLidMapping(this.channelId, c.lid, c.id);
        }
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue;
        void handleBaileysMessage(this.channelId, msg, sock);
      }
    });

    sock.ev.on("messages.update", (updates) => {
      for (const u of updates) {
        const status = u.update?.status;
        if (status !== undefined && status !== null) {
          void this.handleMessageStatusUpdate(u.key.id!, status as number);
        }
      }
    });
  }

  private async handleMessageStatusUpdate(wamid: string, baileysStatus: number) {
    const statusMap: Record<number, string> = { 2: "sent", 3: "delivered", 4: "read" };
    const s = statusMap[baileysStatus];
    if (!s) return;

    try {
      const msg = await prisma.message.findFirst({
        where: { externalId: wamid },
        select: { id: true, sendStatus: true, conversationId: true, organizationId: true },
      });
      if (!msg) return;

      const priority: Record<string, number> = { failed: 0, sent: 1, delivered: 2, read: 3 };
      if ((priority[s] ?? 0) <= (priority[msg.sendStatus] ?? -1)) return;

      await prisma.message.update({
        where: { id: msg.id },
        data: { sendStatus: s },
      });

      try {
        sseBus.publish("message_status", {
          organizationId: msg.organizationId,
          conversationId: msg.conversationId,
          messageId: msg.id,
          status: s,
        });
      } catch {}
    } catch (err) {
      console.warn(`[baileys:${this.channelId}] Erro ao atualizar status:`, err);
    }
  }

  private async handleConnectionUpdate(
    update: Partial<BaileysEventMap["connection.update"]>,
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.clearQrTimer();
      try {
        const qrDataUri = await QRCode.toDataURL(qr, { margin: 1 });
        await prisma.channel.update({
          where: { id: this.channelId },
          data: { status: "QR_READY", qrCode: qrDataUri },
        });
        console.info(`[baileys:${this.channelId}] QR code gerado`);

        this.qrTimer = setTimeout(async () => {
          console.info(`[baileys:${this.channelId}] QR expirado — timeout`);
          await prisma.channel.update({
            where: { id: this.channelId },
            data: { status: "DISCONNECTED", qrCode: null },
          }).catch(() => {});
        }, QR_TIMEOUT_MS);
      } catch (e) {
        console.error(`[baileys:${this.channelId}] erro ao gerar QR:`, e);
      }
    }

    if (connection === "open") {
      this.clearQrTimer();
      this.retryCount = 0;
      const me = this.socket?.user;
      const phone = me?.id?.split(":")[0] ?? me?.id?.split("@")[0] ?? null;

      await prisma.channel.update({
        where: { id: this.channelId },
        data: {
          status: "CONNECTED",
          qrCode: null,
          lastConnectedAt: new Date(),
          phoneNumber: phone,
        },
      });
      console.info(`[baileys:${this.channelId}] conectado — ${phone ?? "sem número"}`);
    }

    if (connection === "close") {
      this.clearQrTimer();
      const statusCode =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : undefined;

      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.info(`[baileys:${this.channelId}] deslogado — limpando sessão`);
        await prisma.baileysAuthKey.deleteMany({ where: { channelId: this.channelId } });
        await prisma.channel.update({
          where: { id: this.channelId },
          data: { status: "DISCONNECTED", qrCode: null, sessionData: Prisma.JsonNull },
        });
        this.socket = null;
        return;
      }

      if (this.retryCount >= RECONNECT_MAX_RETRIES) {
        console.error(`[baileys:${this.channelId}] máximo de tentativas atingido — FAILED`);
        await prisma.channel.update({
          where: { id: this.channelId },
          data: { status: "FAILED", qrCode: null },
        });
        this.socket = null;
        return;
      }

      const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.retryCount);
      this.retryCount++;
      console.info(
        `[baileys:${this.channelId}] desconectado (status=${statusCode}) — reconectando em ${delay}ms (tentativa ${this.retryCount})`,
      );

      await prisma.channel.update({
        where: { id: this.channelId },
        data: { status: "CONNECTING" },
      });

      setTimeout(() => {
        if (!this.destroyed) void this.connect();
      }, delay);
    }
  }

  async sendMessage(jid: string, content: AnyMessageContent): Promise<WAMessage | undefined> {
    if (!this.socket) throw new Error("Socket não conectado");
    return this.socket.sendMessage(jid, content);
  }

  async disconnect(): Promise<void> {
    this.destroyed = true;
    this.clearQrTimer();
    clearChannelMap(this.channelId);
    try {
      this.socket?.end(undefined);
    } catch {
      /* best-effort */
    }
    this.socket = null;
    await prisma.channel.update({
      where: { id: this.channelId },
      data: { status: "DISCONNECTED", qrCode: null },
    });
  }

  async logout(): Promise<void> {
    this.destroyed = true;
    this.clearQrTimer();
    clearChannelMap(this.channelId);
    try {
      await this.socket?.logout();
    } catch {
      /* best-effort */
    }
    this.socket = null;
    await prisma.baileysAuthKey.deleteMany({ where: { channelId: this.channelId } });
    await prisma.channel.update({
      where: { id: this.channelId },
      data: { status: "DISCONNECTED", qrCode: null, sessionData: Prisma.JsonNull },
    });
  }

  private clearQrTimer() {
    if (this.qrTimer) {
      clearTimeout(this.qrTimer);
      this.qrTimer = null;
    }
  }
}
