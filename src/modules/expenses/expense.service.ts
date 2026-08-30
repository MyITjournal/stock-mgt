import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { ExpenseCategoryService } from './expense-category.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

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
   * Expenses in a window, newest first, with the period total and a breakdown
   * per category — which is the shape "what did I spend on transport last
   * month" actually needs.
   */
  async findAll(filter: { categoryId?: string; from?: Date; to?: Date } = {}) {
    const expenses = await this.prisma.expense.findMany({
      where: {
        deletedAt: null,
        ...(filter.categoryId && { categoryId: filter.categoryId }),
        ...((filter.from || filter.to) && {
          occurredAt: {
            ...(filter.from && { gte: filter.from }),
            ...(filter.to && { lte: filter.to }),
          },
        }),
      },
      orderBy: [{ occurredAt: 'desc' }],
      include: EXPENSE_INCLUDE,
    });

    const byCategory = new Map<string, { name: string; total: number }>();
    for (const expense of expenses) {
      const row = byCategory.get(expense.categoryId) ?? {
        name: expense.category.name,
        total: 0,
      };
      row.total += expense.amount;
      byCategory.set(expense.categoryId, row);
    }

    return {
      expenses,
      total: expenses.reduce((sum, expense) => sum + expense.amount, 0),
      byCategory: [...byCategory.entries()]
        .map(([categoryId, row]) => ({ categoryId, ...row }))
        .sort((a, b) => b.total - a.total),
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
