// DNA visual global — fonte única de verdade
// Alterar aqui reflete em todas as telas automaticamente.
// Cores de superfície/texto/borda: tokens do tema (globals.css / .dark).

export const dt = {
  bg: {
    page: "bg-background",
    card: "bg-card",
    hover: "bg-bg-hover",
  },

  text: {
    title: "text-[15px] font-semibold tracking-tight text-slate-900",
    label: "text-[12px] text-slate-400",
    value: "text-[13px] font-medium text-slate-700",
    link: "text-[13px] font-medium text-primary",
    section: "text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted",
    muted: "text-[11px] text-slate-400",
    time: "text-[10px] tabular-nums text-ink-muted",
    preview: "text-[13px] text-ink-muted",
  },

  card: {
    base: "rounded-xl border border-border-soft bg-card overflow-hidden",
    shadow: "shadow-[var(--shadow-card-sm)]",
    row: "flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border-soft last:border-0 hover:bg-bg-hover transition-colors",
    rowSm:
      "flex items-center justify-between gap-2 px-3 py-2 border-b border-border-soft last:border-0 hover:bg-bg-hover transition-colors",
    /** Hover do card Kanban / fila — sombra leve */
    kanbanHover: "hover:shadow-[var(--shadow-card-sm)]",
  },

  pill: {
    /** Tag padrão F — combinar com `tagStyle` / `tagPillStyle` em `utils.ts`. */
    base: "inline-flex items-center px-2 py-0.5 text-[11px] font-semibold leading-tight rounded-[4px]",
    sm: "inline-flex items-center px-2 py-0.5 text-[10px] font-semibold leading-tight rounded-[4px]",
    expired:
      "inline-flex items-center rounded-[4px] border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground",
    neutral:
      "inline-flex items-center rounded-[4px] border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground",
    /** Chip de etapa de pipeline (não é etiqueta de contato). */
    stage:
      "inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-primary shadow-[var(--shadow-sm)]",
  },

  /** Header petróleo do DealWorkspace (coluna esquerda compacta). */
  workspace: {
    leader:
      "shrink-0 border-b border-[#0a3d5e] bg-[#0f4c75]",
    leaderLabel: "mb-1 text-[10px] font-medium text-white/45",
    leaderTitle: "mb-3 truncate text-[14px] font-semibold text-white",
    leaderValue: "text-[13px] font-bold text-white tabular-nums",
    leaderBarTrack: "relative h-[3px] overflow-hidden rounded-full bg-white/10",
    leaderBarFill: "absolute inset-y-0 left-0 rounded-full bg-sky-400 transition-all",
    leaderMeta: "mt-1 text-[10px] text-white/35",
  },

  chat: {
    bubble: {
      /** Cores via `var(--chat-bubble-sent-*)` no wrapper; padding no bloco interno (`px-[9px] py-[5px]`). */
      sent: "rounded-[10px] rounded-br-[2px] shadow-[0_1px_1px_rgba(0,0,0,0.08)]",
      received:
        "rounded-[10px] rounded-bl-[2px] border border-border-soft bg-card shadow-[0_1px_1px_rgba(0,0,0,0.06)]",
      /** Nota interna — faixa compacta (menos altura que bolha de conversa). */
      note: "border-l-2 border-l-[#e2e8f0] bg-[#f8fafc]",
      audio: "rounded-[10px] rounded-br-[2px] shadow-[0_1px_1px_rgba(0,0,0,0.08)]",
    },
    text: {
      sent: "text-[13px] leading-[1.4]",
      received: "text-[13px] leading-[1.4] text-[color:var(--chat-bubble-received-text)]",
      note: "text-[13px] leading-snug text-[var(--color-ink-soft)]",
    },
    time: {
      sent: "text-[10px] tabular-nums",
      received: "text-[10px] tabular-nums text-[color:var(--chat-bubble-received-time)]",
      note: "text-[10px] tabular-nums text-slate-400",
    },
    check: {
      sent: "text-[color:var(--chat-bubble-sent-time)]",
      read: "text-[color:var(--chat-bubble-sent-check-read)]",
      default: "text-ink-subtle",
    },
    fontSize: {
      compact: "text-[14px]",
      full: "text-[15px]",
    },
    dateSep: "rounded-full bg-emerald-100 px-3 py-0.5 text-[11px] font-medium text-emerald-700",
    /** Card de sessão 24h encerrada (footer compactChrome) — ver `chat-window.tsx`. */
    sessionExpiredCard:
      "mx-3 my-2 flex items-center gap-3 rounded-xl border border-red-200 bg-card px-3 py-2.5 shadow-[0_2px_8px_rgba(220,38,38,0.08)]",
    noteLabel: "text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground",
  },

  /** Nomes de ícones Lucide alinhados a `SidebarFieldIcon` em `sidebar-field.tsx`. */
  icons: {
    stage: "Clock",
    owner: "User",
    origin: "MapPin",
    forecast: "Calendar",
    tags: "Tag",
    deal: "Monitor",
    phase: "User",
    engagement: "Activity",
    interests: "Heart",
    contact: "Phone",
    email: "Mail",
    company: "Building2",
    fields: "Tag",
    product: "ShoppingBag",
    responsible: "User",
  } as const,
} as const;
