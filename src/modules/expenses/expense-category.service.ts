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
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from './dto/expense-category.dto';

/**
 * What a new organization starts spending on, so the first expense can be
 * recorded without a setup step. Ordered roughly by how often an FMCG
 * distributor reaches for them.
 *
 * A starting point, not a fixed list — which is the whole reason this is a
 * table and not a Prisma enum, exactly as with `PackagingType`.
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'transport',
  'fuel',
  'diesel and power',
  'salaries',
  'rent',
  'repairs',
  'bank charges',
  'levies and permits',
  'miscellaneous',
] as const;

/** Rows for `createMany`, numbered so pickers list them in that order. */
export function defaultExpenseCategoryRows(organizationId: string) {
  return DEFAULT_EXPENSE_CATEGORIES.map((name, index) => ({
    organizationId,
    name,
    sortOrder: (index + 1) * 10,
  }));
}

@Injectable()
export class ExpenseCategoryService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreateExpenseCategoryDto) {
    // A name freed by a soft delete still occupies the unique constraint, so
    // re-adding "rent" would 409 on a row the caller cannot see. Revive it.
    const buried = await this.prisma.expenseCategory.findFirst({
      where: { name: input.name, deletedAt: { not: null } },
    });
    if (buried) {
      return this.prisma.expenseCategory.update({
        where: { id: buried.id },
        data: {
          deletedAt: null,
          description: input.description ?? null,
          sortOrder: input.sortOrder ?? buried.sortOrder,
        },
      });
    }

    try {
      return await this.prisma.expenseCategory.create({
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
    return this.prisma.expenseCategory.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  async update(id: string, input: UpdateExpenseCategoryDto) {
    await this.findOneOrFail(id);

    try {
      return await this.prisma.expenseCategory.update({
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
   * Soft delete: past expenses keep pointing at the row, so last year's fuel
   * spend still reports as fuel after the business stops tracking it.
   */
  async remove(id: string) {
    await this.findOneOrFail(id);
    await this.prisma.expenseCategory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Throws unless the id names a live category in this organization. */
  async assertExists(id: string) {
    await this.findOneOrFail(id);
  }

  private async findOneOrFail(id: string) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id, deletedAt: null },
    });
    if (!category) throw new NotFoundException('Expense category not found');
    return category;
  }

  private translateUniqueViolation(error: unknown, name: string): Error {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return new ConflictException(
        `An expense category named "${name}" already exists`,
      );
    }
    return error as Error;
  }
}
