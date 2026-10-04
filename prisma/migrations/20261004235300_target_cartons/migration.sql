-- Targets become a category and a number of cartons (DECISIONS.md §12,
-- 2026-10-04). Existing rows were quotas in base units, which cannot be turned
-- back into cartons for a category whose products have different cartons — and
-- the product is still in testing, so the owner asked for them to be cleared.
DELETE FROM "purchase_targets";

-- The old shape allowed exactly one of a category or a product, with one
-- partial unique index per scope. Both go: a target is always a category now.
ALTER TABLE "purchase_targets" DROP CONSTRAINT IF EXISTS "purchase_targets_one_scope";
DROP INDEX IF EXISTS "purchase_targets_category_unique";
DROP INDEX IF EXISTS "purchase_targets_product_unique";

-- DropForeignKey
ALTER TABLE "purchase_targets" DROP CONSTRAINT "purchase_targets_displayUnitId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_targets" DROP CONSTRAINT "purchase_targets_productId_fkey";

-- AlterTable
ALTER TABLE "purchase_targets" DROP COLUMN "displayUnitId",
DROP COLUMN "productId",
DROP COLUMN "targetQuantity",
DROP COLUMN "targetValue",
DROP COLUMN "unitFactor",
ADD COLUMN     "targetCartons" INTEGER NOT NULL,
ALTER COLUMN "categoryId" SET NOT NULL;


-- One target per vendor, category and month — two would each report the full
-- progress, and read as comfortably ahead of a quota nobody has met. Partial,
-- so a removed target does not block setting the same one again.
CREATE UNIQUE INDEX "purchase_targets_category_unique"
ON "purchase_targets" ("organizationId", "supplierId", "periodStart", "categoryId")
WHERE "deletedAt" IS NULL;
