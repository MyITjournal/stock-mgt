-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('retail', 'wholesale', 'mixed');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "businessType" "BusinessType" NOT NULL DEFAULT 'mixed';

