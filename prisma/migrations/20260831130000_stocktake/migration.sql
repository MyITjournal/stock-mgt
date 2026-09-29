-- Stocktake: a physical count, recorded first and posted second.
--
-- Counting is not adjusting. A storekeeper walks the aisles and records what
-- is on the shelf; a manager decides the variance is real before it becomes
-- movements. Between those two acts an open stocktake changes nothing about
-- stock on hand.
--
-- Posting writes ordinary adjustment movements with reason count_correction,
-- so the ledger stays the only source of truth for stock (DECISIONS.md §5).

-- CreateEnum
CREATE TYPE "StocktakeStatus" AS ENUM ('open', 'posted', 'cancelled');

-- CreateTable
CREATE TABLE "stocktakes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "StocktakeStatus" NOT NULL DEFAULT 'open',
    "note" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "startedByUserId" TEXT,
    "postedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "countedQuantity" INTEGER NOT NULL,
    "expectedQuantity" INTEGER NOT NULL,
    "note" TEXT,
    "countedByUserId" TEXT,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocktake_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stocktakes_organizationId_idx" ON "stocktakes"("organizationId");

-- CreateIndex
CREATE INDEX "stocktakes_organizationId_status_idx" ON "stocktakes"("organizationId", "status");

-- CreateIndex
CREATE INDEX "stocktakes_locationId_idx" ON "stocktakes"("locationId");

-- CreateIndex
CREATE INDEX "stocktake_lines_organizationId_idx" ON "stocktake_lines"("organizationId");

-- CreateIndex
CREATE INDEX "stocktake_lines_stocktakeId_idx" ON "stocktake_lines"("stocktakeId");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_lines_stocktakeId_productId_key" ON "stocktake_lines"("stocktakeId", "productId");

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "stocktakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_countedByUserId_fkey" FOREIGN KEY ("countedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
