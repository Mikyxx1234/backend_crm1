/**
 * Compat: reexporta o worker dedicado.
 *
 * Historicamente este arquivo era um helper in-process com tenant-safe
 * `withSystemContext`. A implementação canônica vive agora em
 * `automation-worker.ts` (processo `APP_MODE=worker-automation`).
 */
export { startAutomationWorker } from "./automation-worker";
