-- Credit is exceptional, and the exception is now recorded.
--
-- This product does not sell on credit as a matter of course. An outstanding
-- balance is meant to be cleared before another is given, so the write path
-- refuses a second credit sale to a customer who already owes, with a 409.
--
-- An owner or manager can override that with a reason, which lands here — the
-- same shape as StockMovement.forcedReason, and for the same purpose: the
-- exception has to be reportable rather than invisible.

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "creditOverrideReason" TEXT;
