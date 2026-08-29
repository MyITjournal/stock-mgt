import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';

/**
 * The one location every organization starts with, so stock can be received
 * before anyone has thought about warehouses. A business that only ever has one
 * place never has to touch this screen.
 */
export const DEFAULT_LOCATION = 'Main Store';

/** The seed row, for `seedOrganizationDefaults` in auth.service.ts. */
export function defaultLocationRow(organizationId: string) {
  return {
    organizationId,
    name: DEFAULT_LOCATION,
    description: 'Where stock sits unless it is somewhere else.',
    isDefault: true,
    sortOrder: 10,
  };
}

@Injectable()
export class LocationService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreateLocationDto) {
    // A name freed by a soft delete still occupies the unique constraint, so
    // re-adding "Van 2" would 409 on a row the caller cannot see. Revive it.
    const buried = await this.prisma.location.findFirst({
      where: { name: input.name, deletedAt: { not: null } },
    });
    if (buried) {
      return this.prisma.location.update({
        where: { id: buried.id },
        data: {
          deletedAt: null,
          description: input.description ?? null,
          sortOrder: input.sortOrder ?? buried.sortOrder,
        },
      });
    }

    try {
      const created = await this.prisma.location.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId: TenantContext.requireOrganizationId(),
          name: input.name,
          description: input.description ?? null,
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
          ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
        },
      });

      if (created.isDefault) await this.demoteOtherDefaults(created.id);
      return created;
    } catch (error) {
      throw this.translateUniqueViolation(error, input.name);
    }
  }

  findAll() {
    return this.prisma.location.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  async update(id: string, input: UpdateLocationDto) {
    await this.findOneOrFail(id);

    try {
      const updated = await this.prisma.location.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
          ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
        },
      });

      if (updated.isDefault) await this.demoteOtherDefaults(updated.id);
      return updated;
    } catch (error) {
      throw this.translateUniqueViolation(error, input.name ?? '');
    }
  }

  /**
   * Soft delete, and only when the location is empty. Movements point at it
   * forever — the ledger is append-only — so a location holding stock cannot be
   * retired without stranding that stock where nothing can see it.
   */
  async remove(id: string) {
    const location = await this.findOneOrFail(id);

    const remaining = await this.prisma.stockBalance.aggregate({
      where: { locationId: id },
      _sum: { quantity: true },
    });
    if ((remaining._sum.quantity ?? 0) !== 0) {
      throw new ConflictException(
        'This location still holds stock. Transfer it elsewhere before deleting.',
      );
    }

    if (location.isDefault) {
      throw new ConflictException(
        'The default location cannot be deleted. Make another location the default first.',
      );
    }

    await this.prisma.location.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Throws unless the id names a live location in this organization. */
  async assertExists(id: string) {
    await this.findOneOrFail(id);
  }

  /**
   * The location a movement lands in when the caller named none — the flagged
   * default, or the first one if a hand-edit ever left none flagged.
   */
  async resolveDefaultId(): Promise<string> {
    const preferred = await this.prisma.location.findFirst({
      where: { deletedAt: null, isDefault: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (preferred) return preferred.id;

    const anyLocation = await this.prisma.location.findFirst({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (!anyLocation) {
      throw new NotFoundException(
        'This organization has no locations. Create one before recording stock.',
      );
    }
    return anyLocation.id;
  }

  private async demoteOtherDefaults(keepId: string) {
    await this.prisma.location.updateMany({
      where: { id: { not: keepId }, isDefault: true },
      data: { isDefault: false },
    });
  }

  private async findOneOrFail(id: string) {
    const location = await this.prisma.location.findFirst({
      where: { id, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  private translateUniqueViolation(error: unknown, name: string): Error {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return new ConflictException(`A location named "${name}" already exists`);
    }
    return error as Error;
  }
}
