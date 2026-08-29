-- AlterTable
ALTER TABLE "products" ADD COLUMN     "packagingTypeId" TEXT;

-- CreateTable
CREATE TABLE "packaging_types" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "packaging_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "packaging_types_organizationId_idx" ON "packaging_types"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_types_organizationId_name_key" ON "packaging_types"("organizationId", "name");

-- CreateIndex
CREATE INDEX "products_packagingTypeId_idx" ON "products"("packagingTypeId");

-- AddForeignKey
ALTER TABLE "packaging_types" ADD CONSTRAINT "packaging_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_packagingTypeId_fkey" FOREIGN KEY ("packagingTypeId") REFERENCES "packaging_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

