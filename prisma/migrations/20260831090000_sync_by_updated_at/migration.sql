-- Payments and expenses sync on (updatedAt, id), not (createdAt, id).
--
-- The stock ledger is append-only, so a client that has seen a movement needs
-- nothing further and `createdAt` is the right order. Payments and expenses are
-- mutable: voiding a payment, or editing and soft-deleting an expense, leaves
-- `createdAt` alone. Ordered by `createdAt`, a client that had already paged
-- past that row would never hear about the change — it would go on showing an
-- invoice as settled, or an expense that was deleted a week ago.
--
-- These indexes back the new ordering. See src/common/pagination/keyset-cursor.ts.

-- CreateIndex
CREATE INDEX "expenses_organizationId_updatedAt_id_idx" ON "expenses"("organizationId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "payments_organizationId_updatedAt_id_idx" ON "payments"("organizationId", "updatedAt", "id");
