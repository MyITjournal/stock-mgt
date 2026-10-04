import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BusinessType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { PriceTierView } from './dto/product.response';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { CreatePriceTierDto, UpdatePriceTierDto } from './dto/price-tier.dto';

/** Every organization gets this on registration, so pricing always has a home. */
export const DEFAULT_PRICE_TIER = 'Retail';

export const WHOLESALE_PRICE_TIER = 'Wholesale';

/**
 * The tier a price is read on when the caller named none: the default one.
 *
 * Asking without a tier used to mean "no tier", which priced every unit at the
 * `basePrice × factor` fallback — and, since a base price became optional, at
 * no price at all. A cashier who scanned in the moment before the till had
 * loaded its price lists saw "no price" on a carton that had one. Every read
 * of a price — a scan, a price lookup, the till's search — resolves through
 * this, so they cannot disagree about what "no tier" means.
 */
export async function resolveTierId(
  prisma: Pick<TenantPrisma, 'priceTier'>,
  tierId: string | undefined,
): Promise<string | undefined> {
  if (tierId) return tierId;
  const tier = await prisma.priceTier.findFirst({
    where: { isDefault: true, deletedAt: null },
    select: { id: true },
  });
  return tier?.id;
}

/**
 * The price lists a new shop starts with, by the kind of trading it does.
 *
 * Exactly one is the default — walk-ins and anyone with no tier are priced on
 * it. A shop doing both starts with both lists and Retail as the default,
 * because the customer nobody has set up is the walk-in, and a walk-in pays
 * retail. A wholesaler's default is Wholesale for the same reason: its walk-in
 * is a trader. Changing the business type later adds or removes nothing — a
 * price list with prices in it is not something to delete behind somebody's back.
 */
export function defaultPriceTierRows(
  organizationId: string,
  businessType: BusinessType,
) {
  switch (businessType) {
    case BusinessType.retail:
      return [{ organizationId, name: DEFAULT_PRICE_TIER, isDefault: true }];
    case BusinessType.wholesale:
      return [{ organizationId, name: WHOLESALE_PRICE_TIER, isDefault: true }];
    case BusinessType.mixed:
      return [
        { organizationId, name: DEFAULT_PRICE_TIER, isDefault: true },
        { organizationId, name: WHOLESALE_PRICE_TIER, isDefault: false },
      ];
  }
}

@Injectable()
export class PriceTierService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreatePriceTierDto) {
    try {
      const tier = await this.prisma.priceTier.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId: TenantContext.requireOrganizationId(),
          name: input.name,
          isDefault: input.isDefault ?? false,
        },
      });

      if (tier.isDefault) await this.clearOtherDefaults(tier.id);
      return tier;
    } catch (error) {
      throw this.translateUniqueViolation(error, input.name);
    }
  }

  findAll(): Promise<PriceTierView[]> {
    return this.prisma.priceTier.findMany({
      where: { deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  /** The tier to price against when a customer has none assigned. */
  findDefault() {
    return this.prisma.priceTier.findFirst({
      where: { isDefault: true, deletedAt: null },
    });
  }

  async update(id: string, input: UpdatePriceTierDto) {
    await this.findOneOrFail(id);

    try {
      const tier = await this.prisma.priceTier.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
        },
      });

      if (tier.isDefault) await this.clearOtherDefaults(tier.id);
      return tier;
    } catch (error) {
      throw this.translateUniqueViolation(error, input.name ?? '');
    }
  }

  async remove(id: string) {
    const tier = await this.findOneOrFail(id);
    if (tier.isDefault) {
      throw new ConflictException(
        'Cannot delete the default tier. Make another tier the default first.',
      );
    }

    await this.prisma.priceTier.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Exactly one default per organization, enforced here rather than by a constraint. */
  private async clearOtherDefaults(keepId: string) {
    await this.prisma.priceTier.updateMany({
      where: { id: { not: keepId }, isDefault: true },
      data: { isDefault: false },
    });
  }

  private async findOneOrFail(id: string) {
    const tier = await this.prisma.priceTier.findFirst({
      where: { id, deletedAt: null },
    });
    if (!tier) throw new NotFoundException('Price tier not found');
    return tier;
  }

  private translateUniqueViolation(error: unknown, name: string): Error {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return new ConflictException(
        `A price tier named "${name}" already exists`,
      );
    }
    return error as Error;
  }
}
