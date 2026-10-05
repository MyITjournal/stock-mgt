-- CreateTable
CREATE TABLE "vendor_rebates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "expectedAmount" INTEGER NOT NULL,
    "note" TEXT,
    "billId" TEXT,
    "creditedAmount" INTEGER,
    "creditedAt" TIMESTAMP(3),
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_rebates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_rebates_organizationId_idx" ON "vendor_rebates"("organizationId");

-- CreateIndex
CREATE INDEX "vendor_rebates_billId_idx" ON "vendor_rebates"("billId");

-- CreateIndex
CREATE INDEX "vendor_rebates_organizationId_creditedAt_idx" ON "vendor_rebates"("organizationId", "creditedAt");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_rebates_organizationId_supplierId_periodStart_key" ON "vendor_rebates"("organizationId", "supplierId", "periodStart");

-- AddForeignKey
ALTER TABLE "vendor_rebates" ADD CONSTRAINT "vendor_rebates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_rebates" ADD CONSTRAINT "vendor_rebates_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_rebates" ADD CONSTRAINT "vendor_rebates_billId_fkey" FOREIGN KEY ("billId") REFERENCES "supplier_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A rebate is either expected (nothing set) or credited (all three set), never
-- half of each: a bill id with no amount would lower nothing and say it had.
ALTER TABLE "vendor_rebates" ADD CONSTRAINT "vendor_rebates_credited_together"
  CHECK (
    ("billId" IS NULL AND "creditedAmount" IS NULL AND "creditedAt" IS NULL)
    OR ("billId" IS NOT NULL AND "creditedAmount" > 0 AND "creditedAt" IS NOT NULL)
  );

-- What is expected is a positive amount.
ALTER TABLE "vendor_rebates" ADD CONSTRAINT "vendor_rebates_expected_positive"
  CHECK ("expectedAmount" > 0);
