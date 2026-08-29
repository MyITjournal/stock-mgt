import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import {
  CreatePackagingTypeDto,
  UpdatePackagingTypeDto,
} from './dto/packaging-type.dto';

/**
 * The vocabulary every new organization starts with, so the catalog is usable
 * without a setup step. Ordered as an FMCG shelf runs: single items first,
 * then multipacks, then bulk containers.
 *
 * It is a starting point, not a fixed list — that is the whole reason this is
 * a table rather than a Prisma enum.
 */
export const DEFAULT_PACKAGING_TYPES = [
  'piece',
  'sachet',
  'pouch',
  'bottle',
  'can',
  'tin',
  'jar',
  'tube',
  'pack',
  'roll',
  'carton',
  'crate',
  'bag',
  'keg',
] as const;

/** Rows for `createMany`, numbered so pickers list them in shelf order. */
export function defaultPackagingTypeRows(organizationId: string) {
  return DEFAULT_PACKAGING_TYPES.map((name, index) => ({
    organizationId,
    name,
    sortOrder: (index + 1) * 10,
  }));
}

@Injectable()
export class PackagingTypeService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreatePackagingTypeDto) {
    // A name freed by a soft delete is still occupied as far as the unique
    // constraint is concerned, so re-adding "keg" would 409 on a row the
    // caller cannot see. Revive it instead.
    const buried = await this.prisma.packagingType.findFirst({
      where: { name: input.name, deletedAt: { not: null } },
    });
    if (buried) {
      return this.prisma.packagingType.update({
        where: { id: buried.id },
        data: {
          deletedAt: null,
          description: input.description ?? null,
          sortOrder: input.sortOrder ?? buried.sortOrder,
        },
      });
    }

    try {
      return await this.prisma.packagingType.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId: TenantContext.requireOrganizationId(),
          name: input.name,
          description: input.description ?? null,
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        },
      });
    } catch (error) {
      throw this.translateUniqueViolation(error, input.name);
    }
  }

  findAll() {
    return this.prisma.packagingType.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  async update(id: string, input: UpdatePackagingTypeDto) {
    await this.findOneOrFail(id);

    try {
      return await this.prisma.packagingType.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        },
      });
    } catch (error) {
      throw this.translateUniqueViolation(error, input.name ?? '');
    }
  }

  /**
   * Soft delete: products keep pointing at the row, so a product packaged in a
   * form the business has stopped using still reports what it was.
   */
  async remove(id: string) {
    await this.findOneOrFail(id);
    await this.prisma.packagingType.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Throws unless the id names a live packaging type in this organization. */
  async assertExists(id: string) {
    await this.findOneOrFail(id);
  }

  private async findOneOrFail(id: string) {
    const packagingType = await this.prisma.packagingType.findFirst({
      where: { id, deletedAt: null },
    });
    if (!packagingType) throw new NotFoundException('Packaging type not found');
    return packagingType;
  }

  private translateUniqueViolation(error: unknown, name: string): Error {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return new ConflictException(
        `A packaging type named "${name}" already exists`,
      );
    }
    return error as Error;
  }
}
