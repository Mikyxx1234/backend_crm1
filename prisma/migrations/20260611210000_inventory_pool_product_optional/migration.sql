-- Pool de vaga manual pode não ter produto de catálogo: relaxa NOT NULL.
-- A FK product_id continua (ON DELETE CASCADE) — apenas passa a aceitar NULL.
ALTER TABLE "inventory_pools" ALTER COLUMN "productId" DROP NOT NULL;
