-- Formatacao condicional dos campos personalizados no painel lateral (badge por valor).
-- HighlightRule[] = [{ op, value?, severity, label? }]. Resolvido em src/lib/highlight.ts.
ALTER TABLE "custom_fields" ADD COLUMN IF NOT EXISTS "highlightRules" JSONB;
