import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

/**
 * Vendors goods are bought from.
 *
 * Pulled forward from Slice 4 so a goods receipt links to a real row rather
 * than a typed-in name that would have to be reconciled later. Purchase orders,
 * bills and the monthly purchase targets still belong to Slice 4 — this is only
 * the identity they will all hang off.
 */
@Injectable()
export class SupplierService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreateSupplierDto) {
    const buried = await this.prisma.supplier.findFirst({
      where: { name: input.name, deletedAt: { not: null } },
    });
    if (buried) {
      return this.prisma.supplier.update({
        where: { id: buried.id },
        data: {
          deletedAt: null,
          phone: input.phone ?? buried.phone,
          email: input.email ?? buried.email,
          address: input.address ?? buried.address,
          notes: input.notes ?? buried.notes,
        },
      });
    }

    try {
      return await this.prisma.supplier.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId: TenantContext.requireOrganizationId(),
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          notes: input.notes ?? null,
        },
      });
    } catch (error) {
      throw this.translateUniqueViolation(error, input.name);
    }
  }

  findAll() {
    return this.prisma.supplier.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  async update(id: string, input: UpdateSupplierDto) {
    await this.findOneOrFail(id);

    try {
      return await this.prisma.supplier.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.email !== undefined && { email: input.email }),
          ...(input.address !== undefined && { address: input.address }),
          ...(input.notes !== undefined && { notes: input.notes }),
        },
      });
    } catch (error) {
      throw this.translateUniqueViolation(error, input.name ?? '');
    }
  }

  /**
   * Soft delete: receipts and batches keep pointing at the row, so a delivery
   * from a vendor the business has stopped using still says who it came from.
   */
  async remove(id: string) {
    await this.findOneOrFail(id);
    await this.prisma.supplier.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Throws unless the id names a live supplier in this organization. */
  async assertExists(id: string) {
    await this.findOneOrFail(id);
  }

  private async findOneOrFail(id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  private translateUniqueViolation(error: unknown, name: string): Error {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return new ConflictException(`A supplier named "${name}" already exists`);
    }
    return error as Error;
  }
}
