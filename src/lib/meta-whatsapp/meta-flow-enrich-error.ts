/** Falha ao enriquecer payload de template com botão Flow (definição vs envio). */
export class MetaFlowEnrichError extends Error {
  readonly name = "MetaFlowEnrichError";

  constructor(message: string) {
    super(message);
  }
}

export function isMetaFlowEnrichError(err: unknown): err is MetaFlowEnrichError {
  return err instanceof MetaFlowEnrichError;
}
