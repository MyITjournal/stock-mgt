-- Mark a sale line whose cost of goods sold rests on an estimate.
--
-- Goods arriving and being sold before the paperwork is filed is normal in
-- this trade. When that happens the outbound movement is forced through a
-- shortfall onto a batch with no invoice behind it, and cost of goods sold
-- used to come out as ZERO — a sale reporting 100% margin, with the real cost
-- never appearing in any report.
--
-- The rate is now taken from the product's most recent real lot instead, and
-- lines costed that way are flagged so a margin resting on a guess says so.
-- Existing rows are false: every one of them was costed from a real invoice.

-- AlterTable
ALTER TABLE "sale_lines" ADD COLUMN     "costIsEstimated" BOOLEAN NOT NULL DEFAULT false;
