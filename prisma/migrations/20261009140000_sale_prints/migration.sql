-- CreateEnum
CREATE TYPE "SalePrintKind" AS ENUM ('printed', 'opened');

-- CreateTable
CREATE TABLE "sale_prints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "copy" INTEGER NOT NULL,
    "kind" "SalePrintKind" NOT NULL,
    "printedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_prints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_prints_organizationId_idx" ON "sale_prints"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_prints_saleId_copy_key" ON "sale_prints"("saleId", "copy");

-- AddForeignKey
ALTER TABLE "sale_prints" ADD CONSTRAINT "sale_prints_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_prints" ADD CONSTRAINT "sale_prints_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_prints" ADD CONSTRAINT "sale_prints_printedByUserId_fkey" FOREIGN KEY ("printedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

