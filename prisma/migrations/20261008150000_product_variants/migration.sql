-- Product options (variants), 2026-10-08 — PRD-V2 §2, DECISIONS.md §24.
--
-- Additive: every new variantId is nullable, and null means the product has no
-- options, which is every row that exists today. Nothing is backfilled.


-- DropIndex
DROP INDEX "product_prices_organizationId_productId_tierId_unitId_key";

-- DropIndex
DROP INDEX "stock_balances_organizationId_productId_locationId_batchId_key";

-- DropIndex
DROP INDEX "stocktake_lines_stocktakeId_productId_key";

-- AlterTable
ALTER TABLE "goods_receipt_correction_lines" ADD COLUMN     "variantIdAfter" TEXT,
ADD COLUMN     "variantIdBefore" TEXT;

-- AlterTable
ALTER TABLE "goods_receipt_lines" ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "product_barcodes" ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "product_prices" ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "variantAttributes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "sale_lines" ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "stock_balances" ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "stocktake_lines" ADD COLUMN     "variantId" TEXT;

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "values" TEXT[],
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_organizationId_productId_key_key" ON "product_variants"("organizationId", "productId", "key");

-- CreateIndex
CREATE INDEX "stock_movements_variantId_idx" ON "stock_movements"("variantId");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The three "one row per ..." rules that now include variantId are rebuilt as
-- PARTIAL unique pairs, one WHERE "variantId" IS NULL and one IS NOT NULL.
-- A plain unique over a nullable column does not hold: Postgres treats NULLs as
-- distinct, so two variant-less rows for the same key would both be accepted —
-- the PurchaseTarget trap in DECISIONS.md §13. For balances that would split
-- one lot's stock across two rows without an error anywhere. Prisma cannot
-- express a partial index, so these live here by hand; `migrate diff` was
-- checked afterwards and leaves them alone.

-- One cached balance per product, location, lot and option.
CREATE UNIQUE INDEX "stock_balances_unique_no_variant"
ON "stock_balances" ("organizationId", "productId", "locationId", "batchId")
WHERE "variantId" IS NULL;

CREATE UNIQUE INDEX "stock_balances_unique_variant"
ON "stock_balances" ("organizationId", "productId", "locationId", "batchId", "variantId")
WHERE "variantId" IS NOT NULL;

-- One price per product, tier and unit — and per option, for an option's own.
CREATE UNIQUE INDEX "product_prices_unique_no_variant"
ON "product_prices" ("organizationId", "productId", "tierId", "unitId")
WHERE "variantId" IS NULL;

CREATE UNIQUE INDEX "product_prices_unique_variant"
ON "product_prices" ("organizationId", "productId", "tierId", "unitId", "variantId")
WHERE "variantId" IS NOT NULL;

-- One count line per product (and option) per stocktake.
CREATE UNIQUE INDEX "stocktake_lines_unique_no_variant"
ON "stocktake_lines" ("stocktakeId", "productId")
WHERE "variantId" IS NULL;

CREATE UNIQUE INDEX "stocktake_lines_unique_variant"
ON "stocktake_lines" ("stocktakeId", "productId", "variantId")
WHERE "variantId" IS NOT NULL;
