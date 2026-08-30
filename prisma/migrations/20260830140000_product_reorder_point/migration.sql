-- Low-stock alerts need a threshold to compare against, and there was none.
--
-- In base units, like every other quantity in the ledger. NULL means no level
-- has been set, so the product is left off the low-stock list entirely — which
-- is deliberately different from 0, meaning "tell me the moment it runs out".

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "reorderPoint" INTEGER;
