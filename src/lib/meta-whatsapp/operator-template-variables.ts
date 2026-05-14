/**
 * Metadados das variáveis de corpo/cabeçalho que o operador preenche no envio
 * (alinhado a `WhatsAppTemplateConfig.operatorVariables`).
 */

export type OperatorVariableMeta = {
  key: string;
  label: string;
  example?: string;
};

/** Extrai chaves únicas na ordem de aparição: `{{1}}`, `{{nome}}`, etc. */
export function extractPlaceholderKeysFromBodyText(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const k = m[1].trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

/** Preserva labels/exemplos já gravados quando as chaves continuam iguais. */
export function mergeOperatorVariables(
  bodyText: string,
  previous: OperatorVariableMeta[] | null | undefined,
): OperatorVariableMeta[] {
  const keys = extractPlaceholderKeysFromBodyText(bodyText);
  const prevByKey = new Map((previous ?? []).map((v) => [v.key, v]));
  return keys.map((key) => {
    const old = prevByKey.get(key);
    const ex = old?.example?.trim();
    return {
      key,
      label: old?.label?.trim() || key,
      ...(ex ? { example: ex } : {}),
    };
  });
}
