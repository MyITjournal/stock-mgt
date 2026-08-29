import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrgRole, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { StockService } from './stock.service';

const ORG = 'org-aaa';
const USER = 'user-1';
const PRODUCT = 'product-1';
const LOCATION = 'location-1';

/** A cached balance row as `availableBatches` reads it back. */
function balance(
  batchId: string,
  quantity: number,
  expiry: string | null = null,
  received = '2026-01-01',
) {
  return {
    batchId,
    quantity,
    batch: {
      expiryDate: expiry ? new Date(expiry) : null,
      receivedAt: new Date(received),
    },
  };
}

describe('StockService', () => {
  let service: StockService;
  let prisma: {
    stockMovement: { create: jest.Mock };
    stockBalance: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
    stockBatch: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      stockMovement: {
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: object }) =>
            Promise.resolve({ id: 'movement', ...data }),
          ),
      },
      stockBalance: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
      stockBatch: { create: jest.fn().mockResolvedValue({ id: 'new-batch' }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StockService, { provide: TENANT_PRISMA, useValue: prisma }],
    }).compile();

    service = module.get(StockService);
  });

  const as = <T>(orgRole: OrgRole, fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: ORG, userId: USER, orgRole }, fn);

  describe('recordInbound', () => {
    it('writes a positive movement and moves the cached balance with it', async () => {
      await as(OrgRole.storekeeper, () =>
        service.recordInbound({
          productId: PRODUCT,
          locationId: LOCATION,
          batchId: 'batch-1',
          quantity: 480,
          type: StockMovementType.receipt,
        }),
      );

      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG,
          quantity: 480,
          type: StockMovementType.receipt,
          recordedByUserId: USER,
        }) as object,
      });
      expect(prisma.stockBalance.updateMany).toHaveBeenCalledWith({
        where: { productId: PRODUCT, locationId: LOCATION, batchId: 'batch-1' },
        data: { quantity: { increment: 480 } },
      });
    });

    it('creates the balance row when there is not one yet', async () => {
      prisma.stockBalance.updateMany.mockResolvedValue({ count: 0 });

      await as(OrgRole.storekeeper, () =>
        service.recordInbound({
          productId: PRODUCT,
          locationId: LOCATION,
          batchId: 'batch-1',
          quantity: 24,
          type: StockMovementType.receipt,
        }),
      );

      expect(prisma.stockBalance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG,
          batchId: 'batch-1',
          quantity: 24,
        }) as object,
      });
    });

    it('refuses a fractional or negative quantity', async () => {
      await expect(
        as(OrgRole.owner, () =>
          service.recordInbound({
            productId: PRODUCT,
            locationId: LOCATION,
            batchId: 'batch-1',
            quantity: -5,
            type: StockMovementType.receipt,
          }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('recordOutbound', () => {
    it('takes the shortest-dated batch first and signs the movement negative', async () => {
      prisma.stockBalance.findMany.mockResolvedValue([
        balance('long-dated', 100, '2026-12-01'),
        balance('short-dated', 30, '2026-06-01'),
      ]);

      const movements = await as(OrgRole.sales_rep, () =>
        service.recordOutbound({
          productId: PRODUCT,
          locationId: LOCATION,
          quantity: 10,
          type: StockMovementType.sale,
        }),
      );

      expect(movements).toHaveLength(1);
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          batchId: 'short-dated',
          quantity: -10,
        }) as object,
      });
    });

    it('writes one movement per batch when a pick spans two lots', async () => {
      prisma.stockBalance.findMany.mockResolvedValue([
        balance('short-dated', 30, '2026-06-01'),
        balance('long-dated', 100, '2026-12-01'),
      ]);

      const movements = await as(OrgRole.sales_rep, () =>
        service.recordOutbound({
          productId: PRODUCT,
          locationId: LOCATION,
          quantity: 50,
          type: StockMovementType.sale,
        }),
      );

      expect(movements).toHaveLength(2);
      expect(
        prisma.stockMovement.create.mock.calls.map(
          ([call]: [{ data: { batchId: string; quantity: number } }]) => [
            call.data.batchId,
            call.data.quantity,
          ],
        ),
      ).toEqual([
        ['short-dated', -30],
        ['long-dated', -20],
      ]);
    });

    it('gives the client-supplied id to the first movement only', async () => {
      prisma.stockBalance.findMany.mockResolvedValue([
        balance('a', 5, '2026-06-01'),
        balance('b', 5, '2026-07-01'),
      ]);

      await as(OrgRole.sales_rep, () =>
        service.recordOutbound({
          id: 'from-the-phone',
          productId: PRODUCT,
          locationId: LOCATION,
          quantity: 8,
          type: StockMovementType.sale,
        }),
      );

      const [first, second] = prisma.stockMovement.create.mock.calls as [
        { data: Record<string, unknown> }[],
        { data: Record<string, unknown> }[],
      ];
      expect(first[0].data.id).toBe('from-the-phone');
      expect(second[0].data.id).toBeUndefined();
    });

    describe('when stock does not cover the pick', () => {
      beforeEach(() => {
        prisma.stockBalance.findMany.mockResolvedValue([
          balance('thin', 4, '2026-06-01'),
        ]);
      });

      it('refuses, naming what is short', async () => {
        await expect(
          as(OrgRole.sales_rep, () =>
            service.recordOutbound({
              productId: PRODUCT,
              locationId: LOCATION,
              quantity: 10,
              type: StockMovementType.sale,
            }),
          ),
        ).rejects.toThrow(/short by 6/);
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
      });

      it('lets an owner force it, and records that it was forced', async () => {
        const movements = await as(OrgRole.owner, () =>
          service.recordOutbound({
            productId: PRODUCT,
            locationId: LOCATION,
            quantity: 10,
            type: StockMovementType.sale,
            force: true,
            forcedReason: 'Sold before the delivery was entered.',
          }),
        );

        expect(movements).toHaveLength(2);
        expect(prisma.stockMovement.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            isForced: true,
            forcedReason: 'Sold before the delivery was entered.',
          }) as object,
        });
      });

      it('refuses to let a sales rep force it', async () => {
        await expect(
          as(OrgRole.sales_rep, () =>
            service.recordOutbound({
              productId: PRODUCT,
              locationId: LOCATION,
              quantity: 10,
              type: StockMovementType.sale,
              force: true,
              forcedReason: 'Because I said so.',
            }),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('refuses a forced movement with no reason — the trail is the point', async () => {
        await expect(
          as(OrgRole.manager, () =>
            service.recordOutbound({
              productId: PRODUCT,
              locationId: LOCATION,
              quantity: 10,
              type: StockMovementType.sale,
              force: true,
            }),
          ),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('hangs the uncovered part on the batch it would have picked', async () => {
        await as(OrgRole.owner, () =>
          service.recordOutbound({
            productId: PRODUCT,
            locationId: LOCATION,
            quantity: 10,
            type: StockMovementType.sale,
            force: true,
            forcedReason: 'Counted short.',
          }),
        );

        // 4 from what was there, 6 driving the same batch negative — the total
        // across batches still equals what physically left.
        const quantities = prisma.stockMovement.create.mock.calls.map(
          ([call]: [{ data: { quantity: number } }]) => call.data.quantity,
        );
        expect(quantities).toEqual([-4, -6]);
        expect(prisma.stockBatch.create).not.toHaveBeenCalled();
      });
    });

    it('opens a placeholder batch when the product was never received here', async () => {
      prisma.stockBalance.findMany.mockResolvedValue([]);

      await as(OrgRole.owner, () =>
        service.recordOutbound({
          productId: PRODUCT,
          locationId: LOCATION,
          quantity: 3,
          type: StockMovementType.sale,
          force: true,
          forcedReason: 'Sold from a pallet nobody entered.',
        }),
      );

      // Nothing was bought, so it cost nothing: quantityReceived 0 is what
      // marks the batch as one of these.
      expect(prisma.stockBatch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quantityReceived: 0,
          quantityPaidFor: 0,
          totalCost: 0,
        }) as object,
      });
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          batchId: 'new-batch',
          quantity: -3,
        }) as object,
      });
    });

    it('draws only from the named batch when one is pinned', async () => {
      prisma.stockBalance.findMany.mockResolvedValue([balance('pinned', 50)]);

      await as(OrgRole.manager, () =>
        service.recordOutbound({
          productId: PRODUCT,
          locationId: LOCATION,
          batchId: 'pinned',
          quantity: 5,
          type: StockMovementType.damage,
        }),
      );

      expect(prisma.stockBalance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ batchId: 'pinned' }) as object,
        }),
      );
    });
  });
});
