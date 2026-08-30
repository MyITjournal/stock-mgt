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
    : product.units.find((candidate) => candidate.factor === 1);

  if (!unit) {
    throw new NotFoundException(
      unitId
        ? `Unit ${unitId} does not belong to "${product.name}"`
        : `"${product.name}" has no base unit to count in`,
    );
  }

  return { product, unit };
}
