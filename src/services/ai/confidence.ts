/**
 * Confiança auto-declarada pelo LLM (paridade DataCrazy).
 * Marcador oculto: [CONFIANCA:X.X] — removido antes do envio ao aluno.
 *
 * Handoff runtime no antigo: confidence < 0.40.
 * CONFIDENCE_THRESHOLD config (0.5) era só referência de prompt.
 */

export const AI_CONFIDENCE_HANDOFF_THRESHOLD = 0.4;

export const LOW_CONFIDENCE_HANDOFF_MESSAGE =
  "Vou te conectar com um de nossos consultores que vai te ajudar direitinho, tá? Só um instante 🙂";

const CONFIDENCE_RE =
  /\[CONFIANCA\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*\]/gi;

export type ParsedAgentConfidence = {
  /** Texto sem o marcador (e sem linhas vazias extras no fim). */
  text: string;
  /** Score 0–1, ou null se o modelo não enviou o marcador. */
  confidence: number | null;
};

export function parseAgentConfidence(raw: string): ParsedAgentConfidence {
  let confidence: number | null = null;
  let text = raw ?? "";
  const matches = [...text.matchAll(CONFIDENCE_RE)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    const n = Number.parseFloat(last[1] ?? "");
    if (Number.isFinite(n)) {
      confidence = Math.max(0, Math.min(1, n));
    }
  }
  text = text.replace(CONFIDENCE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, confidence };
}

/**
 * true = deve handoff automático (baixa confiança explícita).
 * Sem marcador: não força handoff (evita falso positivo se o modelo esquecer).
 */
export function shouldHandoffOnLowConfidence(
  confidence: number | null,
  threshold: number = AI_CONFIDENCE_HANDOFF_THRESHOLD,
): boolean {
  if (confidence === null) return false;
  return confidence < threshold;
}
