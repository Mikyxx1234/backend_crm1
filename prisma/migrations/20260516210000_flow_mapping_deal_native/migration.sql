-- Permite mapear respostas do WhatsApp Flow para campos nativos do negócio (deal)
DO $$ BEGIN
  ALTER TYPE "FlowFieldMappingTargetKind" ADD VALUE 'DEAL_NATIVE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
