import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { CreateSaleDto } from './dto/create-sale.dto';
import { multiply } from '../../common/money/money';

/**
 * Interim single-line sales. Slice 5 replaces this with invoices carrying
 * multiple lines, each snapshotting the price charged at the time of sale, and
 * decrementing stock through the movement ledger.
 */
@Injectable()
export class SaleService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreateSaleDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Product not found');

    const customer = await this.prisma.customer.findFirst({
      where: { id: input.customerId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    // Quantity is in base units until Slice 5 lets the caller pick a unit.
    const total = input.total ?? multiply(product.basePrice, input.quantity);

    return this.prisma.sale.create({
      data: {
        organizationId: TenantContext.requireOrganizationId(),
        productId: input.productId,
        customerId: input.customerId,
        quantity: input.quantity,
        total,
      },
      include: { product: true, customer: true },
    });
  }

  findAll() {
    return this.prisma.sale.findMany({
      include: { product: true, customer: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id },
      include: { product: true, customer: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }
}
