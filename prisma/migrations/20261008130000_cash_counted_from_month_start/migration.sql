-- Cash counting starts on 1 October 2026, shop time, not the day cash banking
-- shipped (2026-10-08). Counting from that day left cash taken earlier in the
-- week with no way to be banked: it was never "held", so banking it was refused
-- as more than held. Only shops the first migration stamped are moved, and only
-- ever earlier; null (from the beginning) is left alone. Stored as UTC, as the
-- first migration did.
UPDATE "organizations"
SET "cashCountedFrom" =
  (TIMESTAMP '2026-10-01 00:00:00' AT TIME ZONE "timezone") AT TIME ZONE 'UTC'
WHERE "cashCountedFrom" IS NOT NULL
  AND "cashCountedFrom" >
    (TIMESTAMP '2026-10-01 00:00:00' AT TIME ZONE "timezone") AT TIME ZONE 'UTC';
