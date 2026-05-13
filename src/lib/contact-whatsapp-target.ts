import { prisma } from "@/lib/prisma";

/** Destino Meta: telefone em dígitos e/ou BSUID (business-scoped user id). */
export async function getContactWhatsAppTargets(
  contactId: string
): Promise<{ to?: string; recipient?: string } | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { phone: true, whatsappBsuid: true },
  });
  if (!contact) return null;
  const digits = contact.phone?.replace(/\D/g, "") ?? "";
  const to = digits.length >= 8 ? digits : undefined;
  const recipient = contact.whatsappBsuid?.trim() || undefined;
  if (!to && !recipient) return null;
  return { ...(to ? { to } : {}), ...(recipient ? { recipient } : {}) };
}
