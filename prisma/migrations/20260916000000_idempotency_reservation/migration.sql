-- An idempotency key is now claimed before the handler runs, so a row exists
-- while the work is still in flight and has no answer to store yet.
-- Nullable, not defaulted: NULL means "still running", and every row already
-- in the table has a status, so existing keys keep replaying as before.

-- AlterTable
ALTER TABLE "idempotency_keys" ALTER COLUMN "statusCode" DROP NOT NULL,
ALTER COLUMN "responseBody" DROP NOT NULL;
