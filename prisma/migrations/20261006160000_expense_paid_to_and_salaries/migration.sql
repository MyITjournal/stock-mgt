-- Who was paid, typed, and one salaries category per shop (2026-10-06).

-- AlterTable
ALTER TABLE "expense_categories" ADD COLUMN     "isSalaries" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "paidTo" TEXT;

-- Rows that named a supplier keep that name as who was paid.
UPDATE "expenses" e
SET "paidTo" = s."name"
FROM "suppliers" s
WHERE e."supplierId" = s."id";

-- Every shop was seeded with a "salaries" category. Mark one per shop as the
-- Salaries screen's — a live one before a deleted one (which is revived), and
-- "salaries" itself before "salary" or "wages".
UPDATE "expense_categories" c
SET "isSalaries" = true, "deletedAt" = NULL
FROM (
  SELECT DISTINCT ON ("organizationId") "id"
  FROM "expense_categories"
  WHERE lower(trim("name")) IN ('salaries', 'salary', 'wages')
  ORDER BY "organizationId",
           ("deletedAt" IS NULL) DESC,
           (lower(trim("name")) = 'salaries') DESC,
           "createdAt"
) pick
WHERE c."id" = pick."id";

-- A shop that never had one gets it.
INSERT INTO "expense_categories"
  ("id", "organizationId", "name", "sortOrder", "isSalaries", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'salaries', 40, true, now(), now()
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "expense_categories" c
  WHERE c."organizationId" = o."id" AND c."isSalaries"
);
