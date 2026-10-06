-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "dueDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sales_organizationId_dueDate_idx" ON "sales"("organizationId", "dueDate");


-- Sales already owing get the same five days from the day they were made, so
-- invoices unpaid before this existed appear on the reminder too. "Owing" is
-- the one rule everywhere else uses: the total, less payments nobody voided,
-- less refunds on returns.
UPDATE "sales" s
SET "dueDate" = s."occurredAt" + interval '5 days'
WHERE s."customerId" IS NOT NULL
  AND s."total" > COALESCE((
        SELECT SUM(pa."amount")
        FROM "payment_allocations" pa
        JOIN "payments" p ON p."id" = pa."paymentId"
        WHERE pa."saleId" = s."id" AND p."voidedAt" IS NULL
      ), 0)
    + COALESCE((
        SELECT SUM(r."refundAmount") FROM "sale_returns" r WHERE r."saleId" = s."id"
      ), 0);
