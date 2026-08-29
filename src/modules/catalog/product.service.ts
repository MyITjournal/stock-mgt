import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { splitTaxInclusive } from '../../common/money/money';
import {
  CreateProductDto,
  ProductUnitInput,
  SetProductPriceDto,
  UpdateProductDto,
} from './dto/product.dto';

const PRODUCT_INCLUDE = {
  category: true,
  units: { orderBy: { factor: 'asc' } },
  prices: { include: { tier: true, unit: true } },
} as const;

@Injectable()
export class ProductService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreateProductDto) {
    assertExactlyOneBaseUnit(input.units);
    if (input.categoryId) await this.assertCategoryExists(input.categoryId);

    const sku = input.sku?.trim() || generateSku(input.name);
    const organizationId = TenantContext.requireOrganizationId();

    try {
      return await this.prisma.product.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId,
          sku,
          name: input.name,
          description: input.description ?? null,
          categoryId: input.categoryId ?? null,
          basePrice: input.basePrice,
          costPrice: input.costPrice ?? null,
          ...(input.taxRateBps !== undefined && {
            taxRateBps: input.taxRateBps,
          }),
          ...(input.trackStock !== undefined && {
            trackStock: input.trackStock,
          }),
          units: {
            create: input.units.map((unit) => ({
              organizationId,
              name: unit.name,
              factor: unit.factor,
              // The factor-1 unit is the base; assertExactlyOneBaseUnit has
              // already guaranteed there is exactly one.
              isBase: unit.factor === 1,
              isDefaultSelling: unit.isDefaultSelling ?? unit.factor === 1,
            })),
          },
        },
        include: PRODUCT_INCLUDE,
      });
    } catch (error) {
      throw translateUniqueViolation(error, sku);
    }
  }

  findAll(options: { categoryId?: string; search?: string } = {}) {
    return this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...(options.categoryId && { categoryId: options.categoryId }),
        ...(options.search && {
          OR: [
            {
              name: { contains: options.search, mode: 'insensitive' as const },
            },
            { sku: { contains: options.search, mode: 'insensitive' as const } },
          ],
        }),
      },
      include: PRODUCT_INCLUDE,
      orderBy: { name: 'asc' },
    });
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  /**
   * Product with its tax split, for receipts and margin display.
   *
   * Prices are stored tax-inclusive, so the VAT portion is derived here rather
   * than stored — the two can then never disagree.
   */
  async findOneWithTax(id: string) {
    const product = await this.findOneOrFail(id);
    return {
      ...product,
      tax: splitTaxInclusive(product.basePrice, product.taxRateBps),
    };
  }

  async update(id: string, input: UpdateProductDto) {
    await this.findOneOrFail(id);
    if (input.categoryId) await this.assertCategoryExists(input.categoryId);
    if (input.units) assertExactlyOneBaseUnit(input.units);

    try {
      return await this.prisma.product.update({
        where: { id },
        data: {
          ...(input.sku !== undefined && { sku: input.sku }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.categoryId !== undefined && {
            categoryId: input.categoryId,
          }),
          ...(input.basePrice !== undefined && { basePrice: input.basePrice }),
          ...(input.costPrice !== undefined && { costPrice: input.costPrice }),
          ...(input.taxRateBps !== undefined && {
            taxRateBps: input.taxRateBps,
          }),
          ...(input.trackStock !== undefined && {
            trackStock: input.trackStock,
          }),
        },
        include: PRODUCT_INCLUDE,
      });
    } catch (error) {
      throw translateUniqueViolation(error, input.sku ?? '');
    }
  }

  /** Soft delete, so historical sales keep resolving to a product. */
  async remove(id: string) {
    await this.findOneOrFail(id);
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /** Sets the price of one unit of this product for one customer tier. */
  async setPrice(productId: string, input: SetProductPriceDto) {
    await this.findOneOrFail(productId);

    const unit = await this.prisma.productUnit.findFirst({
      where: { id: input.unitId, productId },
    });
    if (!unit) {
      throw new BadRequestException(
        'That unit does not belong to this product',
      );
    }

    const tier = await this.prisma.priceTier.findFirst({
      where: { id: input.tierId, deletedAt: null },
    });
    if (!tier) throw new NotFoundException('Price tier not found');

    return this.prisma.productPrice.upsert({
      where: {
        organizationId_productId_tierId_unitId: {
          organizationId: unit.organizationId,
          productId,
          tierId: input.tierId,
          unitId: input.unitId,
        },
      },
      create: {
        organizationId: unit.organizationId,
        productId,
        tierId: input.tierId,
        unitId: input.unitId,
        price: input.price,
      },
      update: { price: input.price },
      include: { tier: true, unit: true },
    });
  }

  /**
   * Price of one `unitId` for `tierId`, falling back to the base price scaled
   * by the unit factor when no tier row exists.
   *
   * The fallback is a convenience, not a rule: a real carton price is normally
   * *below* factor x base, which is exactly why ProductPrice is keyed by unit.
   */
  async resolvePrice(productId: string, unitId: string, tierId?: string) {
    const product = await this.findOneOrFail(productId);
    const unit = product.units.find((u) => u.id === unitId);
    if (!unit) {
      throw new BadRequestException(
        'That unit does not belong to this product',
      );
    }

    const tiered = tierId
      ? product.prices.find((p) => p.tierId === tierId && p.unitId === unitId)
      : undefined;

    const price = tiered ? tiered.price : product.basePrice * unit.factor;

    return {
      productId,
      unitId,
      unitName: unit.name,
      baseQuantity: unit.factor,
      price,
      isTierPrice: Boolean(tiered),
      tax: splitTaxInclusive(price, product.taxRateBps),
    };
  }

  private async findOneOrFail(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: PRODUCT_INCLUDE,
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async assertCategoryExists(categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
    });
    if (!category) throw new NotFoundException('Category not found');
  }
}

/**
 * Stock is recorded in base units, so every product needs exactly one unit of
 * factor 1. Without it, a carton could never be converted to a countable
 * quantity and the Slice 3 ledger would have nothing to anchor to.
 */
export function assertExactlyOneBaseUnit(units: ProductUnitInput[]): void {
  const bases = units.filter((unit) => unit.factor === 1);

  if (bases.length === 0) {
    throw new BadRequestException(
      'One unit must have factor 1 to act as the base unit that stock is counted in',
    );
  }
  if (bases.length > 1) {
    throw new BadRequestException(
      `Only one unit may have factor 1, found ${bases.length}: ${bases
        .map((u) => u.name)
        .join(', ')}`,
    );
  }

  const names = units.map((unit) => unit.name.toLowerCase());
  if (new Set(names).size !== names.length) {
    throw new BadRequestException('Unit names must be unique within a product');
  }
}

/** "Peak Milk 400g" -> "PEAK-MILK-400G". Unique per organization. */
export function generateSku(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'PRODUCT';
}

function translateUniqueViolation(error: unknown, sku: string): Error {
  if (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  ) {
    return new ConflictException(`A product with SKU "${sku}" already exists`);
  }
  return error as Error;
}
