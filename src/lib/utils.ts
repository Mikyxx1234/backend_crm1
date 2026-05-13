import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Valor monetário do negócio (API pode serializar Decimal como string). */
export function dealNumericValue(value: number | string): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Returns "#fff" or "#000" depending on which has better contrast against `hex`.
 * Uses WCAG relative luminance formula.
 */
export function getContrastColor(hex: string): string {
  const raw = hex.replace("#", "");
  const r = Number.parseInt(raw.substring(0, 2), 16) / 255;
  const g = Number.parseInt(raw.substring(2, 4), 16) / 255;
  const b = Number.parseInt(raw.substring(4, 6), 16) / 255;
  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.4 ? "#000" : "#fff";
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const META_AVATAR_HOSTS = [
  "lookaside.fbsbx.com",
  "scontent.whatsapp.net",
  "graph.facebook.com",
  "pps.whatsapp.net",
];

/** URL segura para `<img>` no browser (proxy para avatares Meta/WhatsApp). */
export function resolveContactAvatarDisplayUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const u = url.trim();
  if (u.startsWith("/")) return u;
  try {
    const base =
      typeof window !== "undefined" ? window.location.origin : "https://localhost";
    const p = new URL(u, base);
    if (p.pathname.startsWith("/uploads/")) return p.pathname;
    if (META_AVATAR_HOSTS.some((d) => p.hostname === d || p.hostname.endsWith(`.${d}`))) {
      return `/api/media/proxy?url=${encodeURIComponent(u)}`;
    }
  } catch {
    /* ignore */
  }
  return u;
}

/** Digits only — matches phone search regardless of formatting (DDI, parênteses, etc.). */
export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

/** Pipeline board/list client-side search (text + phone by digits). */
export function pipelineDealMatchesSearch(
  qRaw: string,
  parts: {
    title?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    ownerName?: string | null;
    productName?: string | null;
    tagNames?: string[];
    dealNumber?: number | string | null;
  },
): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  const tagLine = (parts.tagNames ?? []).join(" ");
  const numStr = parts.dealNumber != null ? String(parts.dealNumber) : "";
  const haystack = [
    parts.title,
    parts.contactName,
    parts.contactEmail,
    parts.contactPhone,
    parts.ownerName,
    parts.productName,
    tagLine,
    numStr,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack.includes(q)) return true;
  const qDigits = onlyDigits(qRaw);
  const phoneDigits = onlyDigits(parts.contactPhone ?? "");
  if (qDigits.length >= 3 && phoneDigits && phoneDigits.includes(qDigits)) return true;
  return false;
}
