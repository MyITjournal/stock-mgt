-- CreateTable
CREATE TABLE "lot_cost_corrections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "totalCostBefore" INTEGER NOT NULL,
    "totalCostAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_cost_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lot_cost_corrections_organizationId_idx" ON "lot_cost_corrections"("organizationId");

-- CreateIndex
CREATE INDEX "lot_cost_corrections_batchId_idx" ON "lot_cost_corrections"("batchId");

-- AddForeignKey
ALTER TABLE "lot_cost_corrections" ADD CONSTRAINT "lot_cost_corrections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_cost_corrections" ADD CONSTRAINT "lot_cost_corrections_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "stock_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_cost_corrections" ADD CONSTRAINT "lot_cost_corrections_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

