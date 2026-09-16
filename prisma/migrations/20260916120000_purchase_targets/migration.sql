-- CreateTable
CREATE TABLE "purchase_targets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "categoryId" TEXT,
    "productId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "targetQuantity" INTEGER NOT NULL,
    "displayUnitId" TEXT,
    "unitFactor" INTEGER NOT NULL DEFAULT 1,
    "targetValue" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "purchase_targets_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "purchase_targets_organizationId_idx" ON "purchase_targets"("organizationId");
-- CreateIndex
CREATE INDEX "purchase_targets_organizationId_supplierId_periodStart_idx" ON "purchase_targets"("organizationId", "supplierId", "periodStart");
-- AddForeignKey
ALTER TABLE "purchase_targets" ADD CONSTRAINT "purchase_targets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "purchase_targets" ADD CONSTRAINT "purchase_targets_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "purchase_targets" ADD CONSTRAINT "purchase_targets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "purchase_targets" ADD CONSTRAINT "purchase_targets_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "purchase_targets" ADD CONSTRAINT "purchase_targets_displayUnitId_fkey" FOREIGN KEY ("displayUnitId") REFERENCES "product_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactly one scope. A target is for a category or for a product, never both
-- and never neither; without this the rollup has a row it cannot classify.
ALTER TABLE "purchase_targets" ADD CONSTRAINT "purchase_targets_one_scope"
CHECK ((("categoryId" IS NOT NULL)::int + ("productId" IS NOT NULL)::int) = 1);

-- Two PARTIAL unique indexes rather than one @@unique, because Postgres treats
-- NULLs as distinct: a plain unique over (org, supplier, period, categoryId,
-- productId) would happily accept two identical category targets, since both
-- carry productId NULL. A duplicate does not error, it silently doubles the
-- progress that target reports. Prisma cannot express a partial index, so these
-- live here by hand.
--
-- Both exclude soft-deleted rows, so a target that was removed does not block
-- setting the same one again next month.
CREATE UNIQUE INDEX "purchase_targets_category_unique"
ON "purchase_targets" ("organizationId", "supplierId", "periodStart", "categoryId")
WHERE "productId" IS NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "purchase_targets_product_unique"
ON "purchase_targets" ("organizationId", "supplierId", "periodStart", "productId")
WHERE "categoryId" IS NULL AND "deletedAt" IS NULL;
