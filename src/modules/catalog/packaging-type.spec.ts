import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import {
  DEFAULT_PACKAGING_TYPES,
  PackagingTypeService,
  defaultPackagingTypeRows,
} from './packaging-type.service';

const ORG = 'org-aaa';

/** P2002 as Prisma raises it, so the 409 translation is tested on the real shape. */
function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
  });
}

describe('defaultPackagingTypeRows', () => {
  it('stamps the organization on every seeded row', () => {
    const rows = defaultPackagingTypeRows(ORG);
    expect(rows).toHaveLength(DEFAULT_PACKAGING_TYPES.length);
    expect(rows.every((row) => row.organizationId === ORG)).toBe(true);
  });

  it('numbers them in shelf order, leaving gaps to insert into', () => {
    const rows = defaultPackagingTypeRows(ORG);
    expect(rows[0]).toMatchObject({ name: 'piece', sortOrder: 10 });
    expect(rows[1].sortOrder - rows[0].sortOrder).toBe(10);
  });

  it('has no duplicate names, which the unique constraint would reject', () => {
    const names = DEFAULT_PACKAGING_TYPES.map((name) => name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('PackagingTypeService', () => {
  let service: PackagingTypeService;
  let prisma: {
    packagingType: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      packagingType: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackagingTypeService,
        { provide: TENANT_PRISMA, useValue: prisma },
      ],
    }).compile();

    service = module.get(PackagingTypeService);
  });

  /** Creates stamp organizationId from the request store, so tests need one. */
  const asOrg = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: ORG }, fn);

  describe('create', () => {
    it('stamps the caller organization', async () => {
      prisma.packagingType.create.mockResolvedValue({ id: 'p1' });

      await asOrg(() => service.create({ name: 'pouch' }));

      expect(prisma.packagingType.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG,
          name: 'pouch',
          description: null,
        },
      });
    });

    it('honours a client-supplied id, for offline devices', async () => {
      prisma.packagingType.create.mockResolvedValue({ id: 'client-id' });

      await asOrg(() =>
        service.create({ id: 'client-id', name: 'pouch', sortOrder: 25 }),
      );

      expect(prisma.packagingType.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'client-id',
          sortOrder: 25,
        }) as object,
      });
    });

    it('revives a soft-deleted type instead of colliding with it', async () => {
      // The unique constraint still counts a deleted row, so without this the
      // caller gets a 409 naming a type they cannot see in any list.
      prisma.packagingType.findFirst.mockResolvedValue({
        id: 'buried',
        name: 'keg',
        sortOrder: 140,
      });
      prisma.packagingType.update.mockResolvedValue({ id: 'buried' });

      await asOrg(() => service.create({ name: 'keg' }));

      expect(prisma.packagingType.update).toHaveBeenCalledWith({
        where: { id: 'buried' },
        data: { deletedAt: null, description: null, sortOrder: 140 },
      });
      expect(prisma.packagingType.create).not.toHaveBeenCalled();
    });

    it('reports a live duplicate as a conflict naming the type', async () => {
      prisma.packagingType.create.mockRejectedValue(uniqueViolation());

      await expect(
        asOrg(() => service.create({ name: 'pouch' })),
      ).rejects.toThrow(ConflictException);
      await expect(
        asOrg(() => service.create({ name: 'pouch' })),
      ).rejects.toThrow(/"pouch"/);
    });
  });

  describe('findAll', () => {
    it('lists live types in shelf order, ties broken by name', async () => {
      await service.findAll();

      expect(prisma.packagingType.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
    });
  });

  describe('remove', () => {
    it('soft deletes, so products keep reporting what they were packed in', async () => {
      prisma.packagingType.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.packagingType.update.mockResolvedValue({ id: 'p1' });

      await service.remove('p1');

      expect(prisma.packagingType.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { deletedAt: expect.any(Date) as Date },
      });
    });

    it('404s rather than deleting a type from another organization', async () => {
      // The tenant extension has already filtered the row out of findFirst.
      prisma.packagingType.findFirst.mockResolvedValue(null);

      await expect(service.remove('someone-elses')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.packagingType.update).not.toHaveBeenCalled();
    });
  });

  describe('assertExists', () => {
    it('throws when the id names a deleted or foreign type', async () => {
      prisma.packagingType.findFirst.mockResolvedValue(null);
      await expect(service.assertExists('gone')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
