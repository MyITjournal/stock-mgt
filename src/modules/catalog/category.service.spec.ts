import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { CategoryService } from './category.service';

const ORG = 'org-aaa';
const BEVERAGES = { id: 'cat-1', name: 'Beverages', deletedAt: null };

describe('CategoryService', () => {
  let service: CategoryService;
  let prisma: {
    category: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    product: { count: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      category: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      product: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryService,
        { provide: TENANT_PRISMA, useValue: prisma },
      ],
    }).compile();

    service = module.get(CategoryService);
  });

  /** Creates stamp organizationId from the request store, so tests need one. */
  const asOrg = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: ORG }, fn);

  describe('create', () => {
    it('stamps the caller organization', async () => {
      prisma.category.create.mockResolvedValue({ id: 'cat-1' });

      await asOrg(() => service.create({ name: 'Beverages' }));

      expect(prisma.category.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG,
          name: 'Beverages',
        }) as unknown,
      });
    });

    it('revives a deleted category of the same name instead of a 409', async () => {
      prisma.category.findFirst.mockResolvedValueOnce({
        ...BEVERAGES,
        deletedAt: new Date(),
      });
      prisma.category.update.mockResolvedValue(BEVERAGES);

      await asOrg(() => service.create({ name: 'Beverages' }));

      expect(prisma.category.create).not.toHaveBeenCalled();
      expect(prisma.category.update).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
        data: expect.objectContaining({ deletedAt: null }) as unknown,
      });
    });

    it('answers a live duplicate name with a 409', async () => {
      prisma.category.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      await expect(
        asOrg(() => service.create({ name: 'Beverages' })),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('remove', () => {
    beforeEach(() => prisma.category.findFirst.mockResolvedValue(BEVERAGES));

    it('soft-deletes a category nothing files under', async () => {
      await service.remove('cat-1');

      expect(prisma.category.update).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
        data: { deletedAt: expect.any(Date) as unknown },
      });
    });

    it('refuses while products are in it, and says how many', async () => {
      prisma.product.count.mockResolvedValue(12);

      await expect(service.remove('cat-1')).rejects.toThrow(
        '12 products are in "Beverages". Move them to another category first.',
      );
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('counts retired products, which still show the category', async () => {
      await service.remove('cat-1');

      // Only deleted products are excluded — isActive is deliberately not filtered.
      expect(prisma.product.count).toHaveBeenCalledWith({
        where: { categoryId: 'cat-1', deletedAt: null },
      });
    });

    it('refuses while a sub-category hangs off it', async () => {
      prisma.category.count.mockResolvedValue(1);

      await expect(service.remove('cat-1')).rejects.toThrow(
        '1 sub-category is in "Beverages". Move it to another category first.',
      );
    });

    it('names both when both are in the way', async () => {
      prisma.product.count.mockResolvedValue(1);
      prisma.category.count.mockResolvedValue(2);

      await expect(service.remove('cat-1')).rejects.toThrow(
        '1 product and 2 sub-categories are in "Beverages".',
      );
    });

    it('404s a category that is already gone', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(service.remove('cat-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
