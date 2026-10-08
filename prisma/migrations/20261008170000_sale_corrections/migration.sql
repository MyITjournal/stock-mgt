-- CreateTable
CREATE TABLE "sale_corrections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "customerIdBefore" TEXT,
    "customerIdAfter" TEXT,
    "totalBefore" INTEGER NOT NULL,
    "totalAfter" INTEGER NOT NULL,
    "paidBefore" INTEGER NOT NULL,
    "paidAfter" INTEGER NOT NULL,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_correction_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "correctionId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "unitPriceBefore" INTEGER NOT NULL,
    "unitPriceAfter" INTEGER NOT NULL,
    "lineTotalBefore" INTEGER NOT NULL,
    "lineTotalAfter" INTEGER NOT NULL,

    CONSTRAINT "sale_correction_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_corrections_organizationId_idx" ON "sale_corrections"("organizationId");

-- CreateIndex
CREATE INDEX "sale_corrections_saleId_idx" ON "sale_corrections"("saleId");

-- CreateIndex
CREATE INDEX "sale_correction_lines_organizationId_idx" ON "sale_correction_lines"("organizationId");

-- CreateIndex
CREATE INDEX "sale_correction_lines_correctionId_idx" ON "sale_correction_lines"("correctionId");

-- CreateIndex
CREATE INDEX "sale_correction_lines_saleLineId_idx" ON "sale_correction_lines"("saleLineId");

-- AddForeignKey
ALTER TABLE "sale_corrections" ADD CONSTRAINT "sale_corrections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_corrections" ADD CONSTRAINT "sale_corrections_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_corrections" ADD CONSTRAINT "sale_corrections_customerIdBefore_fkey" FOREIGN KEY ("customerIdBefore") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_corrections" ADD CONSTRAINT "sale_corrections_customerIdAfter_fkey" FOREIGN KEY ("customerIdAfter") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_corrections" ADD CONSTRAINT "sale_corrections_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_correction_lines" ADD CONSTRAINT "sale_correction_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_correction_lines" ADD CONSTRAINT "sale_correction_lines_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "sale_corrections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_correction_lines" ADD CONSTRAINT "sale_correction_lines_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "sale_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

