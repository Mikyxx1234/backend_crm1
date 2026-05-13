-- CreateTable
CREATE TABLE IF NOT EXISTS "tags_on_deals" (
    "dealId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "tags_on_deals_pkey" PRIMARY KEY ("dealId","tagId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tags_on_deals_tagId_idx" ON "tags_on_deals"("tagId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_on_deals_dealId_fkey') THEN
    ALTER TABLE "tags_on_deals" ADD CONSTRAINT "tags_on_deals_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_on_deals_tagId_fkey') THEN
    ALTER TABLE "tags_on_deals" ADD CONSTRAINT "tags_on_deals_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
