import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { CreatePriceTierDto, UpdatePriceTierDto } from './dto/price-tier.dto';

/** Every organization gets this on registration, so pricing always has a home. */
export const DEFAULT_PRICE_TIER = 'Retail';

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

  findAll() {
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
