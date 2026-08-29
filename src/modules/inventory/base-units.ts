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
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    include: { units: true },
  });
  if (!product) throw new NotFoundException(`Product ${productId} not found`);

  if (!product.trackStock) {
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
