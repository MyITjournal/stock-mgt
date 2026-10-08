import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrgRole, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { LocationService } from './location.service';
import { StockService } from './stock.service';
import { StocktakeService } from './stocktake.service';

const ORG = 'org-aaa';
const COUNT = 'count-1';
const LOCATION = 'location-1';
const NOODLES = 'product-noodles';
const MILK = 'product-milk';
const CHICKEN = 'option-chicken';
const ONION = 'option-onion';
const PEPPER = 'option-pepper';

const FLAVOURS = [
  { id: CHICKEN, name: 'Chicken', isActive: true },
  { id: ONION, name: 'Onion', isActive: true },
  { id: PEPPER, name: 'Pepper', isActive: true },
];

function line(productId: string, variantId: string | null, counted: number) {
  return {
    id: `line-${productId}-${variantId ?? '-'}`,
    stocktakeId: COUNT,
    productId,
    variantId,
    countedQuantity: counted,
    expectedQuantity: 0,
    note: null,
  };
}

/** What the service hands the stock engine. */
interface Moved {
  variantId: string | null;
  type: StockMovementType;
  quantity: number;
  batchId?: string;
  transferGroupId?: string;
}

/** A count line as the service writes it. */
interface LineWrite {
  where: { stocktakeId: string; productId: string; variantId: string | null };
  data: { variantId: string | null; expectedQuantity: number };
}

/**
 * Counting by option (§24, branch 4). Each option is counted as an item of
 * its own; posting moves what one option is short and another is over on the
 * same lots, and writes off or on only the rest (owner, 2026-10-08).
 */
describe('StocktakeService', () => {
  let service: StocktakeService;
  let stock: {
    recordOutbound: jest.Mock<
      Promise<{ batchId: string; quantity: number }[]>,
      [Moved]
    >;
    recordInbound: jest.Mock<Promise<object>, [Moved]>;
  };
  let prisma: {
    $transaction: jest.Mock;
    stocktake: { findFirst: jest.Mock; update: jest.Mock };
    stocktakeLine: {
      updateMany: jest.Mock<Promise<{ count: number }>, [LineWrite]>;
      create: jest.Mock<Promise<object>, [LineWrite]>;
    };
    stockBalance: { groupBy: jest.Mock; findFirst: jest.Mock };
    stockBatch: { findFirst: jest.Mock; create: jest.Mock };
    product: { findMany: jest.Mock };
  };

  /** On hand at the location, as `groupBy` returns it. */
  const onHand = (rows: [string, string | null, number][]) =>
    prisma.stockBalance.groupBy.mockResolvedValue(
      rows.map(([productId, variantId, quantity]) => ({
        productId,
        variantId,
        _sum: { quantity },
      })),
    );

  const withLines = (lines: ReturnType<typeof line>[]) =>
    prisma.stocktake.findFirst.mockResolvedValue({
      id: COUNT,
      locationId: LOCATION,
      status: 'open',
      lines: lines.map((l) => ({ ...l, product: {}, variant: null })),
    });

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(),
      stocktake: { findFirst: jest.fn(), update: jest.fn() },
      stocktakeLine: {
        updateMany: jest
          .fn<Promise<{ count: number }>, [LineWrite]>()
          .mockResolvedValue({ count: 0 }),
        create: jest.fn<Promise<object>, [LineWrite]>(),
      },
      stockBalance: {
        groupBy: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ batchId: 'lot-newest' }),
      },
      stockBatch: { findFirst: jest.fn(), create: jest.fn() },
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: NOODLES,
            name: 'Indomie',
            trackStock: true,
            variants: FLAVOURS,
          },
          { id: MILK, name: 'Peak Milk', trackStock: true, variants: [] },
        ]),
      },
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );

    // A pick of more than 50 draws on two lots, so a move is seen to land
    // lot for lot.
    stock = {
      recordOutbound: jest.fn((input: Moved) => {
        const { quantity } = input;
        const first = Math.min(quantity, 50);
        return Promise.resolve([
          { batchId: 'lot-A', quantity: -first },
          ...(quantity > first
            ? [{ batchId: 'lot-B', quantity: -(quantity - first) }]
            : []),
        ]);
      }),
      recordInbound: jest.fn<Promise<object>, [Moved]>().mockResolvedValue({}),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StocktakeService,
        { provide: TENANT_PRISMA, useValue: prisma },
        { provide: StockService, useValue: stock },
        { provide: LocationService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(StocktakeService);
  });

  const asManager = <T>(fn: () => Promise<T>) =>
    TenantContext.run(
      { organizationId: ORG, userId: 'user-1', orgRole: OrgRole.manager },
      fn,
    );

  /** What reached the engine, as [option, type, quantity, lot]. */
  const outs = () =>
    stock.recordOutbound.mock.calls.map(([m]) => [
      m.variantId,
      m.type,
      m.quantity,
    ]);
  const ins = () =>
    stock.recordInbound.mock.calls.map(([m]) => [
      m.variantId,
      m.type,
      m.quantity,
      m.batchId,
    ]);

  describe('count', () => {
    it('refuses a product with options counted without one, before writing', async () => {
      withLines([]);
      await expect(
        asManager(() =>
          service.count(COUNT, {
            lines: [{ productId: NOODLES, countedQuantity: 5 }],
          }),
        ),
      ).rejects.toThrow(/comes in options \(Chicken, Onion, Pepper\)/);
      expect(prisma.stocktakeLine.create).not.toHaveBeenCalled();
    });

    it('keeps one line per option, with that option’s own on-hand figure', async () => {
      withLines([]);
      onHand([
        [NOODLES, CHICKEN, 100],
        [NOODLES, ONION, 7],
      ]);
      await asManager(() =>
        service.count(COUNT, {
          lines: [
            { productId: NOODLES, variantId: CHICKEN, countedQuantity: 40 },
            { productId: NOODLES, variantId: ONION, countedQuantity: 30 },
          ],
        }),
      );

      const wheres = prisma.stocktakeLine.updateMany.mock.calls.map(
        ([arg]) => arg.where,
      );
      expect(wheres.map((w) => w.variantId)).toEqual([CHICKEN, ONION]);
      expect(
        prisma.stocktakeLine.create.mock.calls.map(([arg]) => [
          arg.data.variantId,
          arg.data.expectedQuantity,
        ]),
      ).toEqual([
        [CHICKEN, 100],
        [ONION, 7],
      ]);
    });

    it('names no option, as null, for a product without options', async () => {
      withLines([]);
      onHand([[MILK, null, 12]]);
      await asManager(() =>
        service.count(COUNT, {
          lines: [{ productId: MILK, countedQuantity: 10 }],
        }),
      );
      expect(prisma.stocktakeLine.updateMany.mock.calls[0][0].where).toEqual({
        stocktakeId: COUNT,
        productId: MILK,
        variantId: null,
      });
    });
  });

  describe('post', () => {
    it('spreads stock put on one option across the others as a move, writing nothing off', async () => {
      // 100 cartons went to Chicken when the flavours were added; the shelf
      // says 40 Chicken, 30 Onion, 30 Pepper.
      withLines([
        line(NOODLES, CHICKEN, 40),
        line(NOODLES, ONION, 30),
        line(NOODLES, PEPPER, 30),
      ]);
      onHand([[NOODLES, CHICKEN, 100]]);

      await asManager(() => service.post(COUNT));

      expect(outs()).toEqual([[CHICKEN, StockMovementType.transfer_out, 60]]);
      // Lot for lot: 50 left lot A and 10 left lot B.
      expect(ins()).toEqual([
        [ONION, StockMovementType.transfer_in, 30, 'lot-A'],
        [PEPPER, StockMovementType.transfer_in, 20, 'lot-A'],
        [PEPPER, StockMovementType.transfer_in, 10, 'lot-B'],
      ]);
      const groups = new Set(
        [
          ...stock.recordOutbound.mock.calls,
          ...stock.recordInbound.mock.calls,
        ].map(([m]) => m.transferGroupId),
      );
      expect(groups.size).toBe(1);
      expect([...groups][0]).toEqual(expect.any(String));
    });

    it('moves what it can and writes off only what the product is short overall', async () => {
      withLines([line(NOODLES, CHICKEN, 40), line(NOODLES, ONION, 20)]);
      onHand([[NOODLES, CHICKEN, 100]]);

      await asManager(() => service.post(COUNT));

      expect(outs()).toEqual([
        [CHICKEN, StockMovementType.transfer_out, 20],
        [CHICKEN, StockMovementType.adjustment, 40],
      ]);
      expect(ins()).toEqual([
        [ONION, StockMovementType.transfer_in, 20, 'lot-A'],
      ]);
      expect(stock.recordOutbound.mock.calls[1][0].transferGroupId).toBe(
        undefined,
      );
    });

    it('moves what it can and writes on only what the product is over overall', async () => {
      withLines([line(NOODLES, CHICKEN, 90), line(NOODLES, ONION, 30)]);
      onHand([[NOODLES, CHICKEN, 100]]);

      await asManager(() => service.post(COUNT));

      expect(outs()).toEqual([[CHICKEN, StockMovementType.transfer_out, 10]]);
      expect(ins()).toEqual([
        [ONION, StockMovementType.transfer_in, 10, 'lot-A'],
        [ONION, StockMovementType.adjustment, 20, 'lot-newest'],
      ]);
    });

    it('writes a product without options off as before, with no move', async () => {
      withLines([line(MILK, null, 8)]);
      onHand([[MILK, null, 12]]);

      await asManager(() => service.post(COUNT));

      expect(outs()).toEqual([[null, StockMovementType.adjustment, 4]]);
      expect(stock.recordOutbound.mock.calls[0][0].transferGroupId).toBe(
        undefined,
      );
      expect(stock.recordInbound).not.toHaveBeenCalled();
    });

    it('refuses a line counted before its product had options', async () => {
      withLines([line(NOODLES, null, 40)]);
      onHand([[NOODLES, CHICKEN, 100]]);

      const posting = asManager(() => service.post(COUNT));
      await expect(posting).rejects.toThrow(BadRequestException);
      await expect(posting).rejects.toThrow(/counted before it had options/);
      expect(stock.recordOutbound).not.toHaveBeenCalled();
      expect(prisma.stocktake.update).not.toHaveBeenCalled();
    });
  });
});
