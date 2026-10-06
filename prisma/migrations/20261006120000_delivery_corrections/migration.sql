-- AlterEnum
ALTER TYPE "StockAdjustmentReason" ADD VALUE 'receipt_correction';

-- CreateTable
CREATE TABLE "goods_receipt_corrections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "billAmountBefore" INTEGER,
    "billAmountAfter" INTEGER,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_correction_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "correctionId" TEXT NOT NULL,
    "receiptLineId" TEXT NOT NULL,
    "receivedBefore" INTEGER NOT NULL,
    "receivedAfter" INTEGER NOT NULL,
    "paidForBefore" INTEGER NOT NULL,
    "paidForAfter" INTEGER NOT NULL,
    "totalCostBefore" INTEGER NOT NULL,
    "totalCostAfter" INTEGER NOT NULL,

    CONSTRAINT "goods_receipt_correction_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goods_receipt_corrections_organizationId_idx" ON "goods_receipt_corrections"("organizationId");

-- CreateIndex
CREATE INDEX "goods_receipt_corrections_receiptId_idx" ON "goods_receipt_corrections"("receiptId");

-- CreateIndex
CREATE INDEX "goods_receipt_correction_lines_organizationId_idx" ON "goods_receipt_correction_lines"("organizationId");

-- CreateIndex
CREATE INDEX "goods_receipt_correction_lines_correctionId_idx" ON "goods_receipt_correction_lines"("correctionId");

-- CreateIndex
CREATE INDEX "goods_receipt_correction_lines_receiptLineId_idx" ON "goods_receipt_correction_lines"("receiptLineId");

-- AddForeignKey
ALTER TABLE "goods_receipt_corrections" ADD CONSTRAINT "goods_receipt_corrections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_corrections" ADD CONSTRAINT "goods_receipt_corrections_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_correction_lines" ADD CONSTRAINT "goods_receipt_correction_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_correction_lines" ADD CONSTRAINT "goods_receipt_correction_lines_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "goods_receipt_corrections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_correction_lines" ADD CONSTRAINT "goods_receipt_correction_lines_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "goods_receipt_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Figures a delivery line can hold: nothing negative, and never more paid for
-- than arrived.
ALTER TABLE "goods_receipt_correction_lines" ADD CONSTRAINT "goods_receipt_correction_lines_sane"
  CHECK (
    "receivedBefore" >= 0 AND "receivedAfter" >= 0
    AND "paidForBefore" >= 0 AND "paidForAfter" >= 0
    AND "paidForAfter" <= "receivedAfter"
    AND "totalCostBefore" >= 0 AND "totalCostAfter" >= 0
  );
