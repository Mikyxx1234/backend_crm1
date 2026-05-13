/**
 * Design System — fonte única de verdade do DNA visual do CRM
 * (Chat ⇄ Sales Hub ⇄ Kanban ⇄ List).
 *
 * Toda surface do produto deve consumir estes tokens. Não inventar
 * `rounded-3xl`, `text-[15px]`, `border-slate-200` etc. Se o token
 * não existir, adicione um aqui antes de usar.
 *
 * Para tokens específicos dos dashboards (Bento, métricas), veja
 * `@/lib/dashboard-tokens.ts` — eles seguem o mesmo DNA mas têm
 * aplicações próprias.
 *
 * Importação:
 *   import { ds } from "@/lib/design-system";
 *   <div className={ds.card.base}> ... </div>
 *   <span className={ds.chip.soft}> ... </span>
 *
 * ────────────────────────────────────────────────────────────────
 * REGRAS (Chat = source of truth):
 *  • Spacing: 8 / 16 / 24 / 32  (gap-2, gap-4, gap-6, gap-8 / px-2…)
 *  • Radius:  8 / 12 / 16        (rounded-lg / rounded-xl / rounded-2xl)
 *  • Border:  1px solid rgba(0,0,0,0.06)  → border-black/6
 *  • Shadow:  none idle, popover hairline
 *  • Type:    16/semibold (title), 13/medium (body), 12/regular (meta)
 *  • Color:   neutros (white, slate-50/100/400/500/700/900) +
 *             blue-600 para ações/ativos. Status em soft chips
 *             (emerald/rose/amber/violet — sempre 50/700).
 * ────────────────────────────────────────────────────────────────
 */

import type { Transition } from "framer-motion";

// ── Tokens primitivos ───────────────────────────────────────────

/** Escala de espaçamento — uso direto via classes Tailwind (8pt grid). */
export const spacing = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
} as const;

/** Escala de border-radius. */
export const radius = {
  sm: 8, // rounded-lg — chips, mini buttons
  md: 12, // rounded-xl — popovers internos, tag composer
  lg: 16, // rounded-2xl — cards, popovers principais
} as const;

/** Cores neutras canônicas (slate). Use SEMPRE estas — nunca neutral/zinc/gray. */
export const colors = {
  surface: "white",
  surfaceMuted: "slate-50", // hover de itens de lista, soft chips
  surfaceMutedStronger: "slate-100", // chips secundários (counts, status neutro)
  text: {
    primary: "slate-900", // títulos, valores fortes
    body: "slate-700", // texto comum
    muted: "slate-500", // metadata
    subtle: "slate-400", // labels uppercase, ícones inativos, hints
    placeholder: "slate-300", // placeholders, divisores ·
  },
  border: {
    base: "black/6", // 1px solid rgba(0,0,0,0.06) — TODA borda
    hover: "black/10",
    active: "blue-200",
    soft: "slate-100", // divisores horizontais entre seções
  },
  brand: {
    base: "blue-600", // ação primária / ativo
    soft: "blue-50",
    softText: "blue-700",
    ring: "blue-500/40", // focus-visible:ring
  },
  status: {
    success: { bg: "emerald-50", text: "emerald-700", solid: "emerald-500" },
    danger: { bg: "rose-50", text: "rose-700", solid: "rose-500" },
    warn: { bg: "amber-50", text: "amber-700", solid: "amber-500" },
    info: { bg: "blue-50", text: "blue-700", solid: "blue-600" },
    neutral: { bg: "slate-100", text: "slate-600", solid: "slate-400" },
  },
} as const;

// ── Animação ───────────────────────────────────────────────────

/** Spring sutil — micro-interações de cards, popovers. */
export const SUBTLE_SPRING: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.8,
};

/** Shadow do popover (único permitido em surfaces flat). */
export const POPOVER_SHADOW = "0 12px 32px -12px rgba(15,23,42,0.18)";
/** Shadow leve do card ativo. */
export const CARD_ACTIVE_SHADOW = "0 2px 6px rgba(15,23,42,0.06)";

// ── Classes prontas (importe e use) ─────────────────────────────

export const ds = {
  /** ── Cards ──
   *  Estrutura idêntica em todo o app: radius 16, border 1px black/6,
   *  bg branco, sem shadow no idle. `padding` fica a critério da seção
   *  (8pt grid).
   */
  card: {
    /** Card base flat — uso geral. */
    base:
      "rounded-2xl border border-black/6 bg-white transition-colors hover:border-black/10",
    /** Card interativo (clicável, com focus ring). */
    interactive:
      "rounded-2xl border border-black/6 bg-white transition-colors cursor-pointer outline-none hover:border-black/10 focus-visible:ring-2 focus-visible:ring-blue-500/40",
    /** Estado ativo de um card interativo (combine via cn). */
    active: "border-blue-200",
    /** Padding canônico do card (16px). */
    padding: "p-4",
    /** Padding compacto (12px) — para cards densos como list items. */
    paddingCompact: "px-3 py-3",
    /** Padding generoso (24px) — para painéis/sections principais. */
    paddingLoose: "p-6",
  },

  /** ── Chips ──
   *  Soft pills sem borda. Mesma forma e padding em todo lugar.
   */
  chip: {
    /** Chip neutro padrão (counts, etapas, status genérico). */
    soft:
      "inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-600",
    /** Chip muito sutil (slate-50) — para metadata sem peso. */
    softer:
      "inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-0.5 text-[12px] font-medium text-slate-600",
    /** Chip primário (azul) — para etapa/responsável ativo. */
    info:
      "inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[12px] font-medium text-blue-700",
    /** Chip de sucesso (Ganho, online). */
    success:
      "inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-700",
    /** Chip de erro (Perdido). */
    danger:
      "inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2 py-0.5 text-[12px] font-medium text-rose-700",
    /** Chip de atenção (overdue, pendente). */
    warn:
      "inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-700",
    /** Dot 6px usado dentro de chips (pega cor via style). */
    dot: "size-1.5 shrink-0 rounded-full",
  },

  /** ── Tags (lead/deal labels) ──
   *  Chip arredondado (`rounded-lg` = ~8px) com a cor da tag em
   *  `style.backgroundColor` e texto branco. Tipografia "label
   *  uppercase micro" — DNA único pra Chat ⇄ Kanban ⇄ Sales Hub ⇄
   *  Lista ⇄ Header do chat. Aplique via:
   *
   *    <span className={ds.tag.solid} style={{ backgroundColor: tag.color }}>
   *      {tag.name}
   *    </span>
   *
   *  Use `solid` em cards/listas (compacto, 9px) e `solidLg` em headers
   *  com tipografia maior (10px, px-2). Ambos compartilham forma
   *  (`rounded-lg`) e peso (`font-black uppercase tracking-widest`).
   *
   *  Não usar contraste dinâmico (`getContrastColor`) — quebra a
   *  identidade visual; cores hexadecimais escolhidas pelos usuários
   *  já são suficientemente escuras pra contrastarem com texto branco.
   */
  tag: {
    /** Chip principal de tag — compacto (Chat = source of truth). */
    solid:
      "inline-flex max-w-[88px] items-center truncate rounded-lg px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-white",
    /** Chip principal de tag — variante maior, pra contextos com
     *  tipografia destacada (header do chat, contact-info-panel). */
    solidLg:
      "inline-flex items-center truncate rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-white",
    /** Chip "+N" (mais tags ocultas). */
    more:
      "inline-flex items-center rounded-lg bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-500",
    /** Chip "+N" — variante maior (pareada com `solidLg`). */
    moreLg:
      "inline-flex items-center rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500",
    /** Botão "+" para adicionar tag (Kanban). */
    add:
      "inline-flex items-center rounded-lg px-1.5 py-0.5 text-[9px] font-black text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600",
    /** Ícone TagIcon que precede o grupo (size 11). */
    icon: "shrink-0 text-slate-400",
    /**
     * Variante editável (com botão de remover X) — mesmo DNA do
     * `solid` mas sem `max-w-[88px]` (precisa caber nome + ação) e
     * com padding levemente maior pro botão respirar. Use em painéis
     * de detalhe (sidebar do deal, lead, contato).
     */
    solidEditable:
      "group inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white",
  },

  /** ── Inputs ──
   *  Sem border desenhado — apenas hairline ao focar. Bg slate-50/80
   *  no idle, bg branco no foco com inset shadow 1px slate-900/10.
   */
  input: {
    /** Input padrão (busca, texto). */
    base:
      "h-9 w-full rounded-lg bg-slate-50/80 px-3 text-[13px] text-slate-700 placeholder:text-slate-400 outline-none transition-colors focus:bg-white focus:shadow-[inset_0_0_0_1px_rgba(15,23,42,0.1)]",
    /** Input compacto (filtros, popovers). */
    compact:
      "h-7 w-full rounded-md bg-white px-2 text-[12px] text-slate-700 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-500/30",
  },

  /** ── Buttons ── */
  button: {
    /** Primário sólido (ação principal de form/diálogo). */
    primary:
      "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[13px] font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50",
    /** Acento azul (CTA do produto). */
    accent:
      "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[13px] font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50",
    /** Soft (ação secundária — slate-100 fundo). */
    soft:
      "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50",
    /** Ghost (sem fundo, hover slate-50). */
    ghost:
      "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900",
    /** Icon-only button compacto (28px). */
    icon:
      "inline-flex size-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700",
  },

  /** ── Popovers ──
   *  Surface elevada — radius 16, border hairline preta, shadow soft.
   */
  popover: {
    base:
      "overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_12px_32px_-12px_rgba(15,23,42,0.18)]",
    /** Item dentro de popover (lista de seleção). */
    item:
      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-slate-700 transition-colors hover:bg-slate-50",
    /** Item ativo / selecionado. */
    itemActive: "bg-blue-50/60 text-blue-700",
  },

  /** ── Avatar ── (uso como owner/contact) */
  avatar: {
    /** Avatar padrão 28px com iniciais. */
    sm: "flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold uppercase tracking-tight text-white",
    /** Avatar 24px (List view, dropdowns). */
    xs: "flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold uppercase tracking-tight text-white",
    /** Avatar 40px (chat header). */
    md: "flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[13px] font-semibold uppercase tracking-tight text-white",
    /** Slot vazio (dashed circle). */
    empty:
      "flex shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400",
  },

  /** ── Tipografia ── */
  text: {
    /** Title 16px semibold — títulos de cards, seções. */
    title: "text-[16px] font-semibold leading-tight tracking-tight text-slate-900",
    /** Body 13px medium — texto comum em UI densa. */
    body: "text-[13px] font-medium text-slate-700",
    /** Body normal — parágrafos, descrições. */
    bodyNormal: "text-[13px] text-slate-600",
    /** Meta 12px regular — timestamps, contadores, hints. */
    meta: "text-[12px] text-slate-500",
    /** Meta sutil 12px — em estados secundários. */
    metaSubtle: "text-[12px] text-slate-400",
    /** Label uppercase 11px — section labels, tabs. */
    label:
      "text-[11px] font-medium uppercase tracking-wide text-slate-400",
    /** Mono tabular numérico (#id, contagens). */
    mono: "font-mono text-[12px] tabular-nums text-slate-500",
  },

  /** ── Border utilities ── */
  border: {
    base: "border border-black/6",
    hover: "border-black/10",
    active: "border-blue-200",
    /** Divisor horizontal entre seções de um card. */
    divider: "border-t border-slate-100",
    /** Divisor vertical entre colunas. */
    dividerY: "border-r border-slate-100",
  },

  /** ── Focus ring (acessibilidade). */
  focus: "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",

  /** ── Pre-built compositions ── */
  /** Header sticky de listas/colunas (8pt padding, divisor soft). */
  sectionHeader:
    "flex items-center gap-2 border-b border-slate-100 px-4 py-3",
} as const;

// ── Helpers utilitários ────────────────────────────────────────

/**
 * Gera classes para o status chip baseado em uma chave canônica.
 * Use para evitar repetir "if status === WON ..." em todo lugar.
 */
export function statusChip(
  status: "success" | "danger" | "warn" | "info" | "neutral",
): string {
  switch (status) {
    case "success":
      return ds.chip.success;
    case "danger":
      return ds.chip.danger;
    case "warn":
      return ds.chip.warn;
    case "info":
      return ds.chip.info;
    default:
      return ds.chip.soft;
  }
}

/** Iniciais para avatar fallback. */
export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
