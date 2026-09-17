-- What a printed invoice or statement says about the business issuing it.
-- All nullable: an organization that has not filled in its address must still
-- be able to issue an invoice today, so the renderer prints what it has.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "address" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "rcNumber" TEXT,
ADD COLUMN     "taxId" TEXT;
