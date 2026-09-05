-- Which counter or van took the money.
--
-- Added before there are rows worth backfilling: without it, "what did this
-- till take today" cannot be answered from the data at all, and a cash-up at
-- the end of a shift is the first thing anyone asks for once several people
-- are collecting. Nullable, because a transfer landing in the bank belongs to
-- no counter.
--
-- A sale banks its own payment at the sale's location, so counter sales carry
-- it automatically from here on.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "locationId" TEXT;

-- CreateIndex
CREATE INDEX "payments_organizationId_locationId_occurredAt_idx" ON "payments"("organizationId", "locationId", "occurredAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
