-- Pipeline/Stage public slugs for shareable URLs (no CUID in query string).

ALTER TABLE "pipelines" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "slug" TEXT;

-- Basic slugify (ASCII fold for common PT chars + non-alnum → hyphen).
CREATE OR REPLACE FUNCTION tmp_url_slugify(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
BEGIN
  s := lower(coalesce(input, ''));
  s := translate(
    s,
    'áàãâäéèêëíìîïóòõôöúùûüçñÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
  );
  s := regexp_replace(s, '[^a-z0-9]+', '-', 'g');
  s := regexp_replace(s, '(^-|-$)', '', 'g');
  IF s = '' THEN
    s := 'item';
  END IF;
  RETURN s;
END;
$$;

-- Backfill pipelines (unique per organizationId).
DO $$
DECLARE
  r RECORD;
  base text;
  candidate text;
  n int;
BEGIN
  FOR r IN
    SELECT id, "organizationId", name
    FROM pipelines
    WHERE slug IS NULL OR slug = ''
    ORDER BY "createdAt" ASC, id ASC
  LOOP
    base := tmp_url_slugify(r.name);
    candidate := base;
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p."organizationId" = r."organizationId"
        AND p.slug = candidate
        AND p.id <> r.id
    ) LOOP
      n := n + 1;
      candidate := base || '-' || n::text;
    END LOOP;
    UPDATE pipelines SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- Backfill stages (unique per pipelineId).
DO $$
DECLARE
  r RECORD;
  base text;
  candidate text;
  n int;
BEGIN
  FOR r IN
    SELECT id, "pipelineId", name
    FROM stages
    WHERE slug IS NULL OR slug = ''
    ORDER BY position ASC, id ASC
  LOOP
    base := tmp_url_slugify(r.name);
    candidate := base;
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM stages s
      WHERE s."pipelineId" = r."pipelineId"
        AND s.slug = candidate
        AND s.id <> r.id
    ) LOOP
      n := n + 1;
      candidate := base || '-' || n::text;
    END LOOP;
    UPDATE stages SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- Safety for any remaining nulls.
UPDATE pipelines SET slug = 'pipeline-' || left(id, 8) WHERE slug IS NULL OR slug = '';
UPDATE stages SET slug = 'stage-' || left(id, 8) WHERE slug IS NULL OR slug = '';

ALTER TABLE "pipelines" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "stages" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "pipelines_organizationId_slug_key"
  ON "pipelines"("organizationId", "slug");
CREATE UNIQUE INDEX IF NOT EXISTS "stages_pipelineId_slug_key"
  ON "stages"("pipelineId", "slug");

DROP FUNCTION IF EXISTS tmp_url_slugify(text);
