import type { CSSProperties } from "react";
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

/** Tags sem cor / fallback — padrão F neutro (slate). */
export const TAG_STYLE_NEUTRAL: CSSProperties = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  color: "#475569",
  borderRadius: "4px",
};

const TAG_STYLE_VIP: CSSProperties = {
  background: "#fefce8",
  border: "1px solid #fde047",
  color: "#854d0e",
  borderRadius: "4px",
};

/** Normaliza para `#RRGGBB` ou `null` se não for hex utilizável. */
function toTagHex6(color: string): string | null {
  const raw = color.trim();
  if (!raw) return null;
  let h = raw.startsWith("#") ? raw.slice(1) : raw;
  if (h.length === 3 && /^[0-9a-fA-F]{3}$/u.test(h)) {
    h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  if (h.length === 6 && /^[0-9a-fA-F]{6}$/u.test(h)) {
    return `#${h}`;
  }
  if (h.length === 8 && /^[0-9a-fA-F]{8}$/u.test(h)) {
    return `#${h.slice(0, 6)}`;
  }
  return null;
}

/**
 * Padrão F: fundo ~8% (`14`), borda ~30% (`4D`), texto na cor base, radius 4px.
 * Cor inválida ou vazia → neutro slate.
 */
export function tagStyle(color: string | null | undefined): CSSProperties {
  const hex6 = color ? toTagHex6(color) : null;
  if (!hex6) {
    return { ...TAG_STYLE_NEUTRAL };
  }
  return {
    background: `${hex6}14`,
    border: `1px solid ${hex6}4D`,
    color: hex6,
    borderRadius: "4px",
  };
}

/** Como `tagStyle`, mas força estilo VIP pelo nome da etiqueta. */
export function tagPillStyle(tagName: string, color: string | null | undefined): CSSProperties {
  if (tagName.trim().toUpperCase() === "VIP") {
    return { ...TAG_STYLE_VIP };
  }
  return tagStyle(color);
}
