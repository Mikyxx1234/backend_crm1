/**
 * Registro de capacidades (catálogo universal por capacidades) — API pública.
 *
 * Importe daqui: `import { validateCapabilityConfig } from "@/lib/capabilities"`.
 */

export {
  CAPABILITY_KEYS,
  type CapabilityKey,
  type CapabilityDefinition,
  type CapabilityConfig,
  defineCapability,
} from "./types";

export {
  CAPABILITY_REGISTRY,
  getCapability,
  isCapabilityKey,
  validateCapabilityConfig,
  serializeCapabilities,
  type SerializedCapability,
  UnknownCapabilityError,
  CapabilityConfigError,
} from "./registry";

export {
  resolveCapabilityConfig,
  type CatalogCapabilityRow,
  type ProductCapabilityRow,
  type ResolvedCapability,
} from "./resolve";

export {
  assertOverrideAllowed,
  OverrideNotAllowedError,
} from "./override";
