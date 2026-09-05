-- A picture of the product, for pickers on a phone and the web catalog.
--
-- Two columns rather than one: the URL is what clients render, the public id
-- is what lets the previous image be deleted from the CDN when it is replaced.
-- Storing only the URL leaks an orphan on every change. The public id stays
-- NULL when the URL was supplied directly rather than uploaded through us.

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "imagePublicId" TEXT,
ADD COLUMN     "imageUrl" TEXT;
