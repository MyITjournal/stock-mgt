-- AlterTable
ALTER TABLE "goods_receipt_corrections" ADD COLUMN     "deliveryFeeAfter" INTEGER,
ADD COLUMN     "deliveryFeeBefore" INTEGER;

-- AlterTable
ALTER TABLE "goods_receipt_lines" ADD COLUMN     "deliveryCost" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "deliveryFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryFeeBankAccountId" TEXT,
ADD COLUMN     "deliveryFeeMethod" "PaymentMethod",
ADD COLUMN     "deliveryFeePaidByUserId" TEXT,
ADD COLUMN     "deliveryFeePaidTo" TEXT;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_deliveryFeeBankAccountId_fkey" FOREIGN KEY ("deliveryFeeBankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_deliveryFeePaidByUserId_fkey" FOREIGN KEY ("deliveryFeePaidByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

