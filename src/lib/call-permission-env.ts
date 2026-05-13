/** IDs dos botões/listas do template de permissão de chamada (webhook `messages`, tipo interactive). */
export function getCallPermissionAcceptButtonIds(): string[] {
  const raw = process.env.META_WHATSAPP_CALL_PERMISSION_ACCEPT_BUTTON_IDS?.trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Títulos exatos (substring) configurados pelo operador — correspondência além dos padrões automáticos. */
export function getCallPermissionAcceptButtonTitlesFromEnv(): string[] {
  const raw = process.env.META_WHATSAPP_CALL_PERMISSION_ACCEPT_BUTTON_TITLES?.trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function getCallPermissionTemplateName(): string | null {
  const n = process.env.META_WHATSAPP_CALL_PERMISSION_TEMPLATE?.trim();
  return n || null;
}

export function isCallPermissionConfigured(): boolean {
  return !!getCallPermissionTemplateName();
}
