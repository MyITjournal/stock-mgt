-- When staff may sign in.
--
-- Times are minutes past midnight in the organization's timezone; 480 is 08:00
-- and 1140 is 19:00. Per-person columns are nullable and mean "inherit the
-- business hours", so a new employee is covered without anybody remembering to
-- set them.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "closesAt" INTEGER NOT NULL DEFAULT 1140,
ADD COLUMN     "opensAt" INTEGER NOT NULL DEFAULT 480,
ADD COLUMN     "workingDays" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[];

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "closesAt" INTEGER,
ADD COLUMN     "ignoresWorkingHours" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "opensAt" INTEGER,
ADD COLUMN     "workingDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- No window may cross midnight, because there is no night shift yet. This is
-- what keeps the check one comparison instead of two ranges — and it is why
-- adding night shifts later is a real change rather than a tweak.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_hours_ordered"
CHECK ("opensAt" >= 0 AND "closesAt" <= 1440 AND "opensAt" < "closesAt");

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_hours_ordered"
CHECK (
  ("opensAt" IS NULL AND "closesAt" IS NULL)
  OR ("opensAt" >= 0 AND "closesAt" <= 1440 AND "opensAt" < "closesAt")
);
