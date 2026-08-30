-- Voiding a payment: the row stays, and is excluded from every balance.
--
-- A mis-keyed payment and a refund are different facts. A refund is a negative
-- `Payment`, because money genuinely moved back. A void says the opposite —
-- the money never moved, and the row should never have existed.
--
-- Purely additive: existing payments have voidedAt NULL and are unaffected.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedByUserId" TEXT,
ADD COLUMN     "voidedReason" TEXT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
