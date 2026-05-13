/**
 * Design tokens compartilhados entre os 4 dashboards (Principal, Analytics,
 * Analytics SAC, Monitor). Mantém consistência com o polish visual aplicado
 * ao Sales-Hub (commit 408840b), sem duplicar constantes de spring/sombra
 * por arquivo.
 *
 * Importar via `import { SUBTLE_SPRING, dashboardCardClass, ... } from "@/lib/dashboard-tokens"`.
 */
import type { Transition } from "framer-motion";

/** Spring suave usado no sales-hub (funnel-bar, deal-queue). */
export const SUBTLE_SPRING: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.8,
};

/** Spring um tico mais reativo, bom para KPIs e métricas que mudam. */
export const METRIC_SPRING: Transition = {
  type: "spring",
  stiffness: 280,
  damping: 26,
};

/** Fade + slide suave, padrão pra entrada de widgets. */
export const fadeInUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: SUBTLE_SPRING,
};

/**
 * Classe-base de card premium para dashboards (tema claro). Usa `shadow-premium`,
 * borda sutil, radius 2xl. Hover leve. Reutilizar com `cn(dashboardCardClass, "…")`.
 */
export const dashboardCardClass =
  "rounded-2xl border border-border/70 bg-card p-5 shadow-premium transition-shadow duration-300 hover:shadow-float";

/** Variante compacta do card (pra KPIs menores). */
export const dashboardCardClassCompact =
  "rounded-xl border border-border/70 bg-card p-4 shadow-premium transition-shadow duration-300 hover:shadow-float";

/** Classe-base de card premium no modo War Room (fundo dark). */
export const dashboardCardClassDark =
  "rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)] backdrop-blur-sm";

/**
 * Tipografia de título de página do dashboard.
 *
 * Mantido em sincronia com `pageHeaderTitleClass` (src/components/ui/page-header.tsx) —
 * quando a página usar o componente `<PageHeader>` o estilo vem de lá; esta
 * constante existe para headers "soltos" (dashboard home, analytics, monitor)
 * que não usam o componente completo.
 */
export const dashboardPageTitleClass =
  "font-heading text-2xl font-bold tracking-tight text-foreground md:text-3xl";

/** Label em caixa alta (sections, eixos, KPIs). */
export const dashboardLabelClass =
  "text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground";

/** Grid de 4 colunas responsivo (sm:2, lg:4). */
export const kpiGridClass =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4";

/**
 * "Bento box" — card premium do DNA Studioia (ref: AnalyticsPreview.tsx e
 * ChatArea.tsx). Radius generoso (24px), sem borda grossa, sombra sutil que
 * cresce no hover. Usado nos KPIs e painéis do dashboard refeitos.
 */
export const bentoCardClass =
  "rounded-[24px] border border-slate-100 bg-white p-6 shadow-sm transition-shadow duration-300 hover:shadow-md";

/** Variante 32px de radius para painéis grandes (gráficos principais). */
export const bentoCardLargeClass =
  "rounded-[32px] border border-slate-100 bg-white p-8 shadow-sm";

/** Label minúsculo em caixa alta, "ar" Linear/Stripe. */
export const bentoLabelClass =
  "text-[10px] font-black uppercase tracking-widest text-slate-400";

/** Título secundário dos widgets (abaixo do label). */
export const bentoSubtitleClass =
  "text-[18px] font-bold text-slate-900 tracking-tight";

/** Valor principal dos KPIs (dentro do bentoCardClass). */
export const bentoValueClass =
  "text-[28px] font-bold text-slate-900 tracking-tight md:text-[32px]";

/**
 * Paleta de accents ícone → combinações tailwind (bg suave + texto vivo).
 * Mantida em sincronia com as cores do SalesHub funnel e do Studioia preview.
 */
export type BentoAccent =
  | "blue"
  | "emerald"
  | "amber"
  | "violet"
  | "rose"
  | "indigo"
  | "cyan"
  | "slate";

export const bentoAccentMap: Record<BentoAccent, { bg: string; text: string; solid: string }> = {
  blue: { bg: "bg-blue-50", text: "text-brand-blue", solid: "#507df1" },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-600", solid: "#10b981" },
  amber: { bg: "bg-amber-50", text: "text-amber-600", solid: "#f59e0b" },
  violet: { bg: "bg-violet-50", text: "text-violet-600", solid: "#8b5cf6" },
  rose: { bg: "bg-rose-50", text: "text-rose-600", solid: "#f43f5e" },
  indigo: { bg: "bg-indigo-50", text: "text-indigo-600", solid: "#6366f1" },
  cyan: { bg: "bg-cyan-50", text: "text-cyan-600", solid: "#06b6d4" },
  slate: { bg: "bg-slate-100", text: "text-slate-700", solid: "#475569" },
};

/** Grid bento mais denso (6 colunas) usado em dashboards com 6+ KPIs. */
export const bentoGridClass =
  "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

/** Format helpers — locais à camada de view. */
export function formatMs(ms: number, { short = false } = {}): string {
  if (!Number.isFinite(ms) || ms <= 0) return short ? "0m" : "0min";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return short ? `${m}m` : `${m}min`;
  if (m === 0) return short ? `${h}h` : `${h}h`;
  return short ? `${h}h${m.toString().padStart(2, "0")}` : `${h}h ${m}min`;
}

export function formatBRL(value: number, { compact = false } = {}): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}
