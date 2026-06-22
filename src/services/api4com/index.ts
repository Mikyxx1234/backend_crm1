/**
 * Barrel — cliente Api4com (Fase 1) + Provisioning (Fase 2).
 */
export {
  Api4ComClient,
  getApi4ComClient,
  resetApi4ComClient,
  type Api4ComClientOptions,
} from "./client";
export {
  Api4ComAuthError,
  Api4ComConflictError,
  Api4ComError,
  Api4ComServerError,
  Api4ComValidationError,
} from "./errors";
export {
  enableTelephony,
  disableTelephony,
  getProvisioningStatus,
  type ProvisionResult,
  type ProvisionStatus,
} from "./provisioning";
export type {
  AccessTokenResponse,
  Api4ComExtensionResponse,
  Api4ComUser,
  Api4ComUserRole,
  CreateUserRequest,
  DialerAck,
  DialerRequest,
  IntegrationPatch,
} from "./types";
