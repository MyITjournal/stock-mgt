import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import {
  SYNC_LAG_MS,
  decodeCursor,
  encodeCursor,
  keysetWhereUpdated,
} from '../../common/pagination/keyset-cursor';
import { ExpenseCategoryService } from './expense-category.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

/** How many expenses one sync page returns when the caller does not say. */
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;

export interface ExpenseQuery {
  categoryId?: string;
  from?: Date;
  to?: Date;
  /** Sync mode: page by `updatedAt` from here. */
  cursor?: string;
  since?: Date;
  limit?: number;
  /** Include soft-deleted rows, so a syncing client learns about removals. */
  includeDeleted?: boolean;
}

const EXPENSE_INCLUDE = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

/**
 * Money going out that is not the cost of goods.
 *
 * Deliberately thin. This exists so the profit view has both halves of its
 * subtraction — cost of goods sold comes off the sale lines, and everything
 * else comes off here. The moment it grows budgets, approvals or account
 * codes it has become the accounting the product exists to avoid.
 */
@Injectable()
export class ExpenseService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly categories: ExpenseCategoryService,
  ) {}

  async create(input: CreateExpenseDto) {
    await this.categories.assertExists(input.categoryId);
    if (input.supplierId) await this.assertSupplierExists(input.supplierId);

    return this.prisma.expense.create({
      data: {
        ...(input.id && { id: input.id }),
        organizationId: TenantContext.requireOrganizationId(),
        categoryId: input.categoryId,
        amount: input.amount,
        method: input.method ?? PaymentMethod.cash,
        supplierId: input.supplierId ?? null,
        reference: input.reference ?? null,
        note: input.note ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        recordedByUserId: TenantContext.get()?.userId ?? null,
      },
      include: EXPENSE_INCLUDE,
    });
  }

  /**
   * Expenses in a window, with the period total and a breakdown per category —
   * the shape "what did I spend on transport last month" actually needs — and,
   * when asked, paged for delta sync.
   *
   * **Two readers, one endpoint.** A person wants the newest first and does not
   * want to see what was deleted. A syncing device wants a stable order it can
   * resume from, and *does* need to hear about deletions, or it keeps showing an
   * expense that was removed a week ago.
   *
   * So sync mode is opt-in and explicit: pass `cursor` or `since` to page by
   * `updatedAt` (an expense is mutable — it can be edited and soft-deleted —
   * which is why it follows the `keysetWhereUpdated` rule), and
   * `includeDeleted` to receive the tombstones. The defaults are unchanged, so
   * the human view stays exactly as it was.
   *
   * `total` and `byCategory` always describe the **whole filter**, never the
   * page, and always exclude deleted rows. A total that silently meant "this
   * page" would be worse than no total.
   */
  async findAll(filter: ExpenseQuery = {}) {
    const syncing = Boolean(filter.cursor || filter.since);
    const limit = Math.min(filter.limit ?? DEFAULT_PAGE, MAX_PAGE);
    const cursor = filter.cursor ? decodeCursor(filter.cursor) : undefined;
    const syncedThrough = new Date(Date.now() - SYNC_LAG_MS);

    const scope = {
      ...(!filter.includeDeleted && { deletedAt: null }),
      ...(filter.categoryId && { categoryId: filter.categoryId }),
      ...((filter.from || filter.to) && {
        occurredAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    };

    const expenses = await this.prisma.expense.findMany({
      where: syncing
        ? {
            ...scope,
            AND: [
              { updatedAt: { lte: syncedThrough } },
              ...keysetWhereUpdated(cursor, filter.since),
            ],
          }
        : scope,
      orderBy: syncing
        ? [{ updatedAt: 'asc' }, { id: 'asc' }]
        : [{ occurredAt: 'desc' }],
      ...(syncing && { take: limit }),
      include: EXPENSE_INCLUDE,
    });

    // Totals come from their own aggregate rather than from the rows above, so
    // they stay true to the filter even when the rows are one page of many.
    const grouped = await this.prisma.expense.groupBy({
      by: ['categoryId'],
      where: { ...scope, deletedAt: null },
      _sum: { amount: true },
    });

    const names = await this.prisma.expenseCategory.findMany({
      where: { id: { in: grouped.map((row) => row.categoryId) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(names.map((row) => [row.id, row.name]));

    const last = expenses.at(-1);

    return {
      expenses,
      total: grouped.reduce((sum, row) => sum + (row._sum.amount ?? 0), 0),
      byCategory: grouped
        .map((row) => ({
          categoryId: row.categoryId,
          name: nameOf.get(row.categoryId) ?? 'Unknown',
          total: row._sum.amount ?? 0,
        }))
        .sort((a, b) => b.total - a.total),
      ...(syncing && {
        nextCursor:
          expenses.length === limit && last
            ? encodeCursor({ at: last.updatedAt, id: last.id })
            : null,
        syncedThrough,
        hasMore: expenses.length === limit,
      }),
    };
  }

  async findOne(id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, deletedAt: null },
      include: EXPENSE_INCLUDE,
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  async update(id: string, input: UpdateExpenseDto) {
    await this.findOne(id);
    if (input.categoryId) await this.categories.assertExists(input.categoryId);
    if (input.supplierId) await this.assertSupplierExists(input.supplierId);

    return this.prisma.expense.update({
      where: { id },
      data: {
        ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.method !== undefined && { method: input.method }),
        ...(input.supplierId !== undefined && { supplierId: input.supplierId }),
        ...(input.reference !== undefined && { reference: input.reference }),
        ...(input.note !== undefined && { note: input.note }),
        ...(input.occurredAt !== undefined && {
          occurredAt: new Date(input.occurredAt),
        }),
      },
      include: EXPENSE_INCLUDE,
    });
  }

  /** Soft delete, so a corrected month still explains what it used to say. */
  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.expense.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async assertSupplierExists(id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
  }
}
