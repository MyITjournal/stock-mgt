import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import {
  DEFAULT_LOCATION,
  LocationService,
  defaultLocationRow,
} from './location.service';

const ORG = 'org-aaa';

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
  });
}

describe('defaultLocationRow', () => {
  it('seeds one default location, flagged as the default', () => {
    expect(defaultLocationRow(ORG)).toMatchObject({
      organizationId: ORG,
      name: DEFAULT_LOCATION,
      isDefault: true,
    });
  });
});

describe('LocationService', () => {
  let service: LocationService;
  let prisma: {
    location: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    stockBalance: { aggregate: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      location: {
        create: jest.fn().mockResolvedValue({ id: 'l1', isDefault: false }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 'l1', isDefault: false }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      stockBalance: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationService,
        { provide: TENANT_PRISMA, useValue: prisma },
      ],
    }).compile();

    service = module.get(LocationService);
  });

  const asOrg = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: ORG }, fn);

  it('stamps the caller organization on create', async () => {
    await asOrg(() => service.create({ name: 'Shop Counter' }));

    expect(prisma.location.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        name: 'Shop Counter',
      }) as object,
    });
  });

  it('honours a client-supplied id, for offline devices', async () => {
    await asOrg(() => service.create({ id: 'client-id', name: 'Van 2' }));

    expect(prisma.location.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 'client-id' }) as object,
    });
  });

  it('revives a soft-deleted location instead of colliding with it', async () => {
    prisma.location.findFirst.mockResolvedValue({
      id: 'buried',
      sortOrder: 40,
    });
    prisma.location.update.mockResolvedValue({ id: 'buried' });

    await asOrg(() => service.create({ name: 'Van 2' }));

    expect(prisma.location.update).toHaveBeenCalledWith({
      where: { id: 'buried' },
      data: { deletedAt: null, description: null, sortOrder: 40 },
    });
    expect(prisma.location.create).not.toHaveBeenCalled();
  });

  it('translates a duplicate name into a 409', async () => {
    prisma.location.create.mockRejectedValue(uniqueViolation());

    await expect(
      asOrg(() => service.create({ name: 'Main Store' })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('leaves exactly one default when a new location claims it', async () => {
    prisma.location.create.mockResolvedValue({ id: 'l2', isDefault: true });

    await asOrg(() => service.create({ name: 'Warehouse', isDefault: true }));

    expect(prisma.location.updateMany).toHaveBeenCalledWith({
      where: { id: { not: 'l2' }, isDefault: true },
      data: { isDefault: false },
    });
  });

  describe('remove', () => {
    it('refuses while the location still holds stock', async () => {
      prisma.location.findFirst.mockResolvedValue({
        id: 'l1',
        isDefault: false,
      });
      prisma.stockBalance.aggregate.mockResolvedValue({
        _sum: { quantity: 12 },
      });

      // Movements point at it forever, so retiring it would strand what is
      // there where no report can see it.
      await expect(asOrg(() => service.remove('l1'))).rejects.toThrow(
        /still holds stock/,
      );
    });

    it('refuses to remove the default location', async () => {
      prisma.location.findFirst.mockResolvedValue({
        id: 'l1',
        isDefault: true,
      });

      await expect(asOrg(() => service.remove('l1'))).rejects.toThrow(
        /default location/,
      );
    });

    it('soft deletes an empty one', async () => {
      prisma.location.findFirst.mockResolvedValue({
        id: 'l1',
        isDefault: false,
      });

      await asOrg(() => service.remove('l1'));

      expect(prisma.location.update).toHaveBeenCalledWith({
        where: { id: 'l1' },
        data: { deletedAt: expect.any(Date) as Date },
      });
    });
  });

  describe('resolveDefaultId', () => {
    it('prefers the flagged default', async () => {
      prisma.location.findFirst.mockResolvedValue({ id: 'flagged' });

      await expect(asOrg(() => service.resolveDefaultId())).resolves.toBe(
        'flagged',
      );
    });

    it('falls back to the first location if a hand-edit left none flagged', async () => {
      prisma.location.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'first' });

      await expect(asOrg(() => service.resolveDefaultId())).resolves.toBe(
        'first',
      );
    });

    it('throws when the organization has no locations at all', async () => {
      prisma.location.findFirst.mockResolvedValue(null);

      await expect(
        asOrg(() => service.resolveDefaultId()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
