-- CreateTable
CREATE TABLE "supplier_bills" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "goodsReceiptId" TEXT,
    "invoiceNumber" TEXT,
    "amountDue" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "note" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "supplier_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'cash',
    "bankAccountId" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedReason" TEXT,
    "voidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bills_goodsReceiptId_key" ON "supplier_bills"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "supplier_bills_organizationId_idx" ON "supplier_bills"("organizationId");

-- CreateIndex
CREATE INDEX "supplier_bills_organizationId_supplierId_idx" ON "supplier_bills"("organizationId", "supplierId");

-- CreateIndex
CREATE INDEX "supplier_bills_organizationId_issuedAt_idx" ON "supplier_bills"("organizationId", "issuedAt");

-- CreateIndex
CREATE INDEX "supplier_bills_organizationId_updatedAt_id_idx" ON "supplier_bills"("organizationId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "supplier_payments_organizationId_idx" ON "supplier_payments"("organizationId");

-- CreateIndex
CREATE INDEX "supplier_payments_billId_idx" ON "supplier_payments"("billId");

-- CreateIndex
CREATE INDEX "supplier_payments_organizationId_supplierId_idx" ON "supplier_payments"("organizationId", "supplierId");

-- CreateIndex
CREATE INDEX "supplier_payments_organizationId_occurredAt_idx" ON "supplier_payments"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "supplier_payments_organizationId_updatedAt_id_idx" ON "supplier_payments"("organizationId", "updatedAt", "id");

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

