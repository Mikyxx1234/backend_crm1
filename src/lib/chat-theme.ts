/** Temas da bolha "enviada" no chat — chave persistida em `User.chatTheme`. */
export const CHAT_THEME_KEYS = ["azul", "whatsapp", "slate", "petroleo", "roxo"] as const;
export type ChatThemeKey = (typeof CHAT_THEME_KEYS)[number];

export const DEFAULT_CHAT_THEME: ChatThemeKey = "azul";

export function isChatThemeKey(value: unknown): value is ChatThemeKey {
  return typeof value === "string" && (CHAT_THEME_KEYS as readonly string[]).includes(value);
}

/** Metadados pra seletor de preferências (preview). Cores canônicas = CSS em `globals.css`. */
export const CHAT_THEME_OPTIONS: {
  key: ChatThemeKey;
  label: string;
  preview: { bubbleBg: string; bubbleText: string; chatBg: string };
}[] = [
  { key: "azul", label: "Azul suave", preview: { bubbleBg: "#dbeafe", bubbleText: "#1e3a5f", chatBg: "#f8fafc" } },
  { key: "whatsapp", label: "WhatsApp", preview: { bubbleBg: "#d9fdd3", bubbleText: "#111b21", chatBg: "#efeae2" } },
  { key: "slate", label: "Slate escuro", preview: { bubbleBg: "#1e293b", bubbleText: "#ffffff", chatBg: "#f1f5f9" } },
  { key: "petroleo", label: "Petróleo", preview: { bubbleBg: "#0f4c75", bubbleText: "#ffffff", chatBg: "#e8f4f8" } },
  { key: "roxo", label: "Roxo", preview: { bubbleBg: "#6d28d9", bubbleText: "#ffffff", chatBg: "#f5f3ff" } },
];
