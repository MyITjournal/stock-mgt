-- AddForeignKey
ALTER TABLE "goods_receipt_corrections" ADD CONSTRAINT "goods_receipt_corrections_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

