/**
 * Heurística: a Graph às vezes omite `type: "FLOW"` mas envia flow_id / flow_name / flow_json.
 * Módulo sem dependências Node — seguro para import em Client Components.
 */
export function isFlowDefinitionButton(btn: Record<string, unknown>): boolean {
  const t = String(btn.type ?? "").toUpperCase();
  if (t === "FLOW") return true;
  if (btn.flow_id != null && String(btn.flow_id).trim() !== "") return true;
  if (typeof btn.flow_name === "string" && btn.flow_name.trim() !== "") return true;
  const fj = btn.flow_json;
  if (typeof fj === "string" && fj.trim() !== "") return true;
  return false;
}
