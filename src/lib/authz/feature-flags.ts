/**
 * Feature flag de Permissions v2 — Sprint 1 (Fundação).
 *
 * Wrapper enxuto sobre `isFeatureEnabled("permissions_v2_enabled", orgId)`.
 * Delega para o sistema canônico em `@/lib/feature-flags` (que faz cache
 * Redis + override por env + override em DB).
 *
 * Escopo da flag:
 *  - Sprint 1 (catálogo + presets + import-guard granular): SEMPRE ATIVO.
 *    A flag NÃO desliga as mudanças feitas neste sprint — elas são
 *    consideradas seguras e idempotentes.
 *  - Sprint 3+ (escopo dinâmico de inbox/deals/canais/fases): a flag
 *    controla. Quando false, o backend mantém o comportamento atual e os
 *    helpers de scope retornam grants vazios (= sem restrição extra).
 *
 * Ativar por org:
 *   INSERT INTO organization_feature_flags (organization_id, key, enabled)
 *   VALUES ('<orgId>', 'permissions_v2_enabled', true);
 */
import { isFeatureEnabled } from "@/lib/feature-flags";

export async function isPermissionsV2Enabled(
  organizationId: string,
): Promise<boolean> {
  if (!organizationId) return false;
  return isFeatureEnabled("permissions_v2_enabled", organizationId);
}
