-- Add type column to products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'PRODUCT';

-- Create index on type
CREATE INDEX IF NOT EXISTS "products_type_idx" ON "products"("type");

-- Create product_custom_field_values table
CREATE TABLE IF NOT EXISTS "product_custom_field_values" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "product_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS "product_custom_field_values_productId_customFieldId_key"
    ON "product_custom_field_values"("productId", "customFieldId");

-- Create index on productId
CREATE INDEX IF NOT EXISTS "product_custom_field_values_productId_idx"
    ON "product_custom_field_values"("productId");

-- Add foreign keys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'product_custom_field_values_productId_fkey'
    ) THEN
        ALTER TABLE "product_custom_field_values"
            ADD CONSTRAINT "product_custom_field_values_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'product_custom_field_values_customFieldId_fkey'
    ) THEN
        ALTER TABLE "product_custom_field_values"
            ADD CONSTRAINT "product_custom_field_values_customFieldId_fkey"
            FOREIGN KEY ("customFieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
