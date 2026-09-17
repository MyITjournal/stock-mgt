-- Staff identity, and the seat cap.
--
-- `email` becomes nullable because most cashiers in this market have no working
-- address; `username` is what they sign in with instead, stored qualified by the
-- organization slug so it is globally unique. Every existing row keeps its email,
-- so nothing is invalidated.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "maxUsers" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "username" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- A person must be reachable by something, or they can never sign in. Prisma
-- cannot express this, so it lives here: the model allows either column to be
-- null, and only the pair being null is nonsense.
ALTER TABLE "users" ADD CONSTRAINT "users_have_an_identifier"
CHECK ("email" IS NOT NULL OR "username" IS NOT NULL);
