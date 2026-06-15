/**
 * Override policy enforcement — backend-side.
 *
 * `.cursorrules`: "A política de override (LOCKED | DEFAULT | OPEN) é aplicada
 * NO BACKEND, não só na UI. Um `ProductCapability` que viola `LOCKED` deve
 * ser rejeitado pela API."
 *
 * Esta função é a única fonte da regra. As rotas (`PUT /api/products/[id]`,
 * `POST /api/products/[id]/capabilities/...`) DEVEM chamá-la antes de persistir.
 */

import type {
  CatalogCapabilityRow,
  ProductCapabilityRow,
} from "./resolve";

export class OverrideNotAllowedError extends Error {
  constructor(
    public readonly capabilityKey: string,
    public readonly policy: "LOCKED",
    public readonly reason: string,
  ) {
    super(
      `Override negado: capacidade "${capabilityKey}" está LOCKED no catálogo (${reason}).`,
    );
    this.name = "OverrideNotAllowedError";
  }
}

/**
 * Garante que o draft de `ProductCapability` respeita a policy do catálogo.
 *
 * Regras:
 *   LOCKED  : produto não pode ter `mode` diferente, nem `config`/`unitOverrides`
 *             populados (qualquer chave). Capacidade pode estar ligada (enabled)
 *             ou desligada — sem override de configuração.
 *   DEFAULT : produto pode sobrescrever qualquer coisa.
 *   OPEN    : idem DEFAULT.
 *   sem catálogo (capacidade ligada só no produto) : sem restrição.
 *
 * Lança `OverrideNotAllowedError` quando viola — rotas convertem para 422/403.
 */
export function assertOverrideAllowed(
  catalogCap: CatalogCapabilityRow | null,
  productDraft: Pick<
    ProductCapabilityRow,
    "capabilityKey" | "mode" | "config" | "unitOverrides"
  >,
): void {
  if (!catalogCap) return; // sem catálogo, sem regra
  if (catalogCap.overridePolicy !== "LOCKED") return;

  const key = productDraft.capabilityKey;

  if (productDraft.mode && productDraft.mode !== catalogCap.mode) {
    throw new OverrideNotAllowedError(
      key,
      "LOCKED",
      `mode do produto ("${productDraft.mode}") difere do catálogo ("${catalogCap.mode}")`,
    );
  }

  if (productDraft.config && Object.keys(productDraft.config).length > 0) {
    throw new OverrideNotAllowedError(
      key,
      "LOCKED",
      `config do produto está populado (${
        Object.keys(productDraft.config).length
      } chave(s))`,
    );
  }

  if (
    productDraft.unitOverrides &&
    Object.keys(productDraft.unitOverrides).length > 0
  ) {
    throw new OverrideNotAllowedError(
      key,
      "LOCKED",
      `unitOverrides do produto está populado`,
    );
  }
}
