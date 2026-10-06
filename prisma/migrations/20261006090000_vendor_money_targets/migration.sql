-- CreateTable
CREATE TABLE "vendor_money_targets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "addsVat" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_money_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_money_targets_organizationId_idx" ON "vendor_money_targets"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_money_targets_organizationId_supplierId_periodStart_key" ON "vendor_money_targets"("organizationId", "supplierId", "periodStart");

-- AddForeignKey
ALTER TABLE "vendor_money_targets" ADD CONSTRAINT "vendor_money_targets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_money_targets" ADD CONSTRAINT "vendor_money_targets_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A target is a positive amount.
ALTER TABLE "vendor_money_targets" ADD CONSTRAINT "vendor_money_targets_amount_positive"
  CHECK ("amount" > 0);
