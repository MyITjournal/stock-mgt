-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "cashCountedFrom" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "cash_bankings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "heldByUserId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "bankAccountId" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedReason" TEXT,
    "voidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_bankings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_bankings_organizationId_heldByUserId_idx" ON "cash_bankings"("organizationId", "heldByUserId");

-- CreateIndex
CREATE INDEX "cash_bankings_organizationId_occurredAt_idx" ON "cash_bankings"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "cash_bankings_organizationId_updatedAt_id_idx" ON "cash_bankings"("organizationId", "updatedAt", "id");

-- AddForeignKey
ALTER TABLE "cash_bankings" ADD CONSTRAINT "cash_bankings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bankings" ADD CONSTRAINT "cash_bankings_heldByUserId_fkey" FOREIGN KEY ("heldByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bankings" ADD CONSTRAINT "cash_bankings_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bankings" ADD CONSTRAINT "cash_bankings_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bankings" ADD CONSTRAINT "cash_bankings_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_bankings" ADD CONSTRAINT "cash_bankings_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Shops that exist today start counting cash at midnight, shop time, today —
-- not from their first sale, which would show every person "still holding"
-- months of cash banked long ago with nothing recorded. Stored as UTC, the way
-- Prisma stores every other timestamp. Shops created after this keep null:
-- from the beginning.
UPDATE "organizations"
SET "cashCountedFrom" =
  (date_trunc('day', now() AT TIME ZONE "timezone") AT TIME ZONE "timezone") AT TIME ZONE 'UTC';
