-- AlterTable: controle de estoque/limite por produto (aditivo, não-quebra)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "track_stock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock" DECIMAL(12,2) NOT NULL DEFAULT 0;
