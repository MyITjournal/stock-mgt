-- "Running low": stock that will not last this many days at the rate it sells.
-- Seven to start, for every shop; one number per shop (2026-10-09).
ALTER TABLE "organizations" ADD COLUMN "lowStockDays" INTEGER NOT NULL DEFAULT 7;
