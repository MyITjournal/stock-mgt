-- Shops that already exist have been recording VAT on every sale, so they
-- start with it on: nothing changes for them until the owner switches it off.
-- The column is added with DEFAULT true so every existing row is filled in as
-- on, then the default drops to false for shops created from now on.
ALTER TABLE "organizations" ADD COLUMN "chargesVat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "organizations" ALTER COLUMN "chargesVat" SET DEFAULT false;
