import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';

/**
 * Stock is recorded in base units — the one unit per product with `factor = 1`.
 * Everyone else speaks in cartons.
 *
 * The conversion happens once, on write, and the factor used is copied onto the
 * row that recorded it. A later edit to what a carton contains must not
 * retroactively change how much stock a past delivery brought in.
 */
export async function resolveProductUnit(
  prisma: TenantPrisma,
  productId: string,
  unitId?: string,
  options: {
    /**
     * Return a non-stocked product instead of rejecting it. Selling is the
     * case: a service still belongs on an invoice, priced and taxed like
     * anything else — it simply never reaches the ledger. Moving stock is not,
     * which is why this is off by default.
     */
    allowUnstocked?: boolean;
    /**
     * Load the tier prices too. Selling needs them, and asks for them here so
     * the product is read once rather than again inside the pricing service.
     */
    withPrices?: boolean;
    /**
     * Resolve for the till: with no unit named, take the default *selling*
     * unit rather than the base, and refuse a unit that is not sold. Counting
     * is not selling — a distributor counts in sachets and never sells one —
     * so only selling asks; deliveries, counts and adjustments use any unit.
     */
    forSale?: boolean;
  } = {},
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    include: { units: true, prices: options.withPrices },
  });
  if (!product) throw new NotFoundException(`Product ${productId} not found`);

  if (!product.trackStock && !options.allowUnstocked) {
    throw new BadRequestException(
      `"${product.name}" is not stocked, so it has no stock to move.`,
    );
  }

  const unit = unitId
    ? product.units.find((candidate) => candidate.id === unitId)
    : options.forSale
      ? (product.units.find((u) => u.isDefaultSelling && u.isSellable) ??
        product.units.find((u) => u.isSellable))
      : product.units.find((candidate) => candidate.factor === 1);

  if (!unit) {
    throw new NotFoundException(
      unitId
        ? `Unit ${unitId} does not belong to "${product.name}"`
        : options.forSale
          ? `"${product.name}" has no unit that is sold at the till`
          : `"${product.name}" has no base unit to count in`,
    );
  }

  if (options.forSale && !unit.isSellable) {
    throw new BadRequestException(
      `"${product.name}" is not sold by the ${unit.name}. Sell it in one of the units ticked "Sold at the till".`,
    );
  }

  return { product, unit };
}
