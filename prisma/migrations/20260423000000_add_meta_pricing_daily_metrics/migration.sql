-- CreateTable
CREATE TABLE "meta_pricing_daily_metrics" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "pricingType" TEXT NOT NULL,
    "pricingCategory" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "phoneNumber" TEXT NOT NULL DEFAULT '',
    "tier" TEXT NOT NULL DEFAULT '',
    "volume" INTEGER NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_pricing_daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_pricing_daily_metrics_date_idx" ON "meta_pricing_daily_metrics"("date");

-- CreateIndex
CREATE INDEX "meta_pricing_daily_metrics_pricingCategory_idx" ON "meta_pricing_daily_metrics"("pricingCategory");

-- CreateIndex
CREATE UNIQUE INDEX "meta_pricing_unique_combo" ON "meta_pricing_daily_metrics"("date", "pricingType", "pricingCategory", "country", "phoneNumber", "tier");
