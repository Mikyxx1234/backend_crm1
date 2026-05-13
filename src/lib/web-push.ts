import "server-only";
import webpush from "web-push";

import { prisma } from "@/lib/prisma";

/**
 * Wrapper do `web-push` (RFC 8030) com:
 *  - Configuracao VAPID via env vars (lazy, single-shot).
 *  - Helper `sendPushToUser` que faz fan-out pra TODAS as
 *    subscriptions ativas do operador, atualiza `lastUsedAt` no
 *    sucesso, e marca `failedAt` (+ deleta) quando o push service
 *    retorna 410/404 (subscription morta).
 *  - Logs informativos pra diagnostico em producao.
 *
 * VAPID:
 *  Chaves estaticas — gera uma vez via `npx web-push generate-vapid-keys`
 *  e cola em VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY no .env. A public
 *  key vai pro browser (servida em /api/push/vapid-public).
 */

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.VAPID_SUBJECT?.trim() || "mailto:admin@eduit.com.br";

  if (!publicKey || !privateKey) {
    console.warn(
      "[web-push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ausentes — push desativado.",
    );
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  renotify?: boolean;
  image?: string;
  icon?: string;
  vibrate?: number[];
  data?: Record<string, unknown>;
}

export function isPushConfigured(): boolean {
  return ensureConfigured();
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() ?? null;
}

/**
 * Envia push pra TODAS as subscriptions de um usuario.
 * Best-effort: erros individuais nao quebram o batch (cada
 * subscription e independente).
 *
 * @returns numero de envios bem-sucedidos.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<number> {
  if (!ensureConfigured()) return 0;

  const subs = await prisma.webPushSubscription.findMany({
    where: { userId, failedAt: null },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (subs.length === 0) return 0;

  const body = JSON.stringify(payload);
  let success = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60 * 24 }, // 24h — alem disso o push service descarta.
        );
        success++;
        // Best-effort: nao bloqueia se update falhar.
        prisma.webPushSubscription
          .update({ where: { id: sub.id }, data: { lastUsedAt: new Date() } })
          .catch(() => {});
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        // 410 Gone / 404 Not Found = subscription morta. Limpamos.
        if (status === 410 || status === 404) {
          prisma.webPushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {});
        } else {
          // Outros erros: marca como falhou pra revisao manual,
          // mas nao deleta (pode ser problema transiente do push
          // service).
          prisma.webPushSubscription
            .update({ where: { id: sub.id }, data: { failedAt: new Date() } })
            .catch(() => {});
          console.error("[web-push] send failed:", status, err);
        }
      }
    }),
  );

  return success;
}

/**
 * Fan-out pra varios usuarios em paralelo. Retorna agregado.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<{ delivered: number; targetedUsers: number }> {
  if (userIds.length === 0) return { delivered: 0, targetedUsers: 0 };

  const results = await Promise.all(
    userIds.map((id) => sendPushToUser(id, payload)),
  );
  return {
    delivered: results.reduce((a, b) => a + b, 0),
    targetedUsers: userIds.length,
  };
}

/**
 * Helper de alto nivel: quando uma mensagem inbound chega, notifica
 *  - o operador atribuido a conversa (se houver), OU
 *  - todos os admins/managers (fallback pra leads sem owner).
 *
 * Tag = conversationId garante que mensagens consecutivas da mesma
 * conversa AGRUPAM na bandeja (substituem a anterior em vez de
 * empilhar). Padrao WhatsApp.
 */
export async function notifyInboundMessage(params: {
  conversationId: string;
  contactId: string;
  contactName: string;
  preview: string;
  channel?: "WhatsApp" | "Email" | "Instagram" | "Meta";
}): Promise<void> {
  if (!ensureConfigured()) return;

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: params.conversationId },
      select: { assignedToId: true, contact: { select: { assignedToId: true } } },
    });

    // Quem notificar:
    //  1. Owner da conversa (assignedToId direto na conversa)
    //  2. Owner do contato (fallback)
    //  3. Todos admins/managers (lead novo sem owner)
    const targets = new Set<string>();
    if (conversation?.assignedToId) targets.add(conversation.assignedToId);
    if (conversation?.contact?.assignedToId)
      targets.add(conversation.contact.assignedToId);

    if (targets.size === 0) {
      const supervisors = await prisma.user.findMany({
        where: { role: { in: ["ADMIN", "MANAGER"] } },
        select: { id: true },
        take: 10,
      });
      supervisors.forEach((u) => targets.add(u.id));
    }

    if (targets.size === 0) return;

    const channelLabel =
      params.channel && params.channel !== "WhatsApp"
        ? ` · ${params.channel}`
        : "";

    await sendPushToUsers(Array.from(targets), {
      title: `${params.contactName}${channelLabel}`,
      body: params.preview.slice(0, 140) || "Nova mensagem",
      url: `/inbox?conversationId=${params.conversationId}`,
      tag: `conv:${params.conversationId}`,
      renotify: false,
      data: {
        conversationId: params.conversationId,
        contactId: params.contactId,
      },
    });
  } catch (err) {
    console.error("[web-push] notifyInboundMessage failed (non-fatal):", err);
  }
}
