import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  ExpenseCategoryService,
  defaultExpenseCategoryRows,
} from './expense-category.service';

const ORG = 'org-aaa';

describe('defaultExpenseCategoryRows', () => {
  it('seeds a new organization with the usual FMCG spending', () => {
    const rows = defaultExpenseCategoryRows(ORG);

    expect(rows).toHaveLength(DEFAULT_EXPENSE_CATEGORIES.length);
    expect(rows.every((row) => row.organizationId === ORG)).toBe(true);
    expect(rows.map((row) => row.name)).toContain('diesel and power');
  });

  it('numbers them so pickers list them in the order given', () => {
    const rows = defaultExpenseCategoryRows(ORG);

    expect(rows[0]).toMatchObject({ name: 'transport', sortOrder: 10 });
    expect(rows.map((row) => row.sortOrder)).toEqual(
      [...rows.keys()].map((index) => (index + 1) * 10),
    );
  });
});

describe('ExpenseCategoryService', () => {
  let service: ExpenseCategoryService;
  let prisma: { expenseCategory: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      expenseCategory: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'category-1' }),
        update: jest.fn().mockResolvedValue({ id: 'category-1' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseCategoryService,
        { provide: TENANT_PRISMA, useValue: prisma },
      ],
    }).compile();

    service = module.get(ExpenseCategoryService);
  });

  const as = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: ORG, orgRole: OrgRole.owner }, fn);

  it('creates a category', async () => {
    await as(() => service.create({ name: 'fuel' }));

    expect(prisma.expenseCategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        name: 'fuel',
      }) as object,
    });
  });

  /**
   * A soft-deleted name still occupies the unique constraint, so recreating it
   * would 409 on a row the caller cannot see. Same trap `PackagingType` hit.
   */
  it('revives a deleted category instead of colliding with it', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'buried',
      sortOrder: 40,
      deletedAt: new Date(),
    });

    await as(() => service.create({ name: 'rent' }));

    expect(prisma.expenseCategory.create).not.toHaveBeenCalled();
    expect(prisma.expenseCategory.update).toHaveBeenCalledWith({
      where: { id: 'buried' },
      data: expect.objectContaining({ deletedAt: null }) as object,
    });
  });

  it('reports a duplicate name as a conflict', async () => {
    prisma.expenseCategory.create.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );

    await expect(
      as(() => service.create({ name: 'fuel' })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes softly, so last year’s spend still reports under its name', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({ id: 'category-1' });

    await as(() => service.remove('category-1'));

    expect(prisma.expenseCategory.update).toHaveBeenCalledWith({
      where: { id: 'category-1' },
      data: { deletedAt: expect.any(Date) as Date },
    });
  });

  it('does not find another organization’s category', async () => {
    await expect(as(() => service.findOne('elsewhere'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
