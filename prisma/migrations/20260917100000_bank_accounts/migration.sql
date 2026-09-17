-- The accounts a business is paid into, and which one a payment landed in.
-- Additive: the column is nullable, so payments recorded before this existed
-- keep their meaning. ON DELETE RESTRICT on the payment side because an
-- account with money recorded against it must not vanish from under it.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "bankAccountId" TEXT;

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankCode" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_organizationId_idx" ON "bank_accounts"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_organizationId_bankName_accountNumber_key" ON "bank_accounts"("organizationId", "bankName", "accountNumber");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
