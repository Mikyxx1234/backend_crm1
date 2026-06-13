-- Tags de Contato (TagOnContact → tags_on_contacts)
-- Tabela de junção que associa Tags a Contatos.
-- Escrita de forma IDEMPOTENTE para ser segura em ambientes
-- onde o schema foi aplicado manualmente ou divergiu.

-- CreateTable
CREATE TABLE IF NOT EXISTS "tags_on_contacts" (
    "contactId" TEXT NOT NULL,
    "tagId"     TEXT NOT NULL,

    CONSTRAINT "tags_on_contacts_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tags_on_contacts_tagId_idx" ON "tags_on_contacts"("tagId");

-- AddForeignKey: contactId → contacts
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tags_on_contacts_contactId_fkey'
  ) THEN
    ALTER TABLE "tags_on_contacts"
      ADD CONSTRAINT "tags_on_contacts_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "contacts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: tagId → tags
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tags_on_contacts_tagId_fkey'
  ) THEN
    ALTER TABLE "tags_on_contacts"
      ADD CONSTRAINT "tags_on_contacts_tagId_fkey"
      FOREIGN KEY ("tagId") REFERENCES "tags"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
