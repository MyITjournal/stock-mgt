import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrgRole, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { StockService } from '../inventory/stock.service';
import { SaleReturnService } from './sale-return.service';
import { SaleService } from './sale.service';
import { CreateReturnDto } from './dto/create-return.dto';

const ORG = 'org-aaa';
const SALE = 'sale-1';
const LINE = 'line-1';
const PRODUCT = 'product-1';
const LOCATION = 'location-1';
const CARTON = 'unit-carton';

/**
 * Two cartons — 48 pieces — sold for ₦108,000, which cost ₦36,000 to buy. The
 * pick spanned two lots: 24 from the short-dated one, then 24 from the other.
 */
const SOLD_LINE = {
  id: LINE,
  productId: PRODUCT,
  unitId: CARTON,
  baseQuantity: 48,
  lineTotal: 10_800_000,
  costOfGoodsSold: 3_600_000,
};

describe('SaleReturnService', () => {
  let service: SaleReturnService;
  let stock: { recordInbound: jest.Mock };
  let tx: { saleReturn: { create: jest.Mock } };
  let prisma: {
    sale: { findFirst: jest.Mock };
    productUnit: { findFirst: jest.Mock };
    stockMovement: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = { saleReturn: { create: jest.fn().mockResolvedValue({}) } };

    prisma = {
      sale: {
        findFirst: jest.fn().mockResolvedValue({
          id: SALE,
          locationId: LOCATION,
          lines: [SOLD_LINE],
          returns: [],
        }),
      },
      productUnit: { findFirst: jest.fn().mockResolvedValue({ factor: 24 }) },
      stockMovement: {
        // Newest first, which is the order the service asks for: the lot
        // picked last is the one refilled first.
        findMany: jest.fn().mockResolvedValue([
          { batchId: 'batch-long-dated', quantity: -24 },
          { batchId: 'batch-short-dated', quantity: -24 },
        ]),
      },
      $transaction: jest
        .fn()
        .mockImplementation((fn: (client: unknown) => unknown) => fn(tx)),
    };

    stock = {
      recordInbound: jest.fn().mockResolvedValue({ id: 'movement-2' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaleReturnService,
        { provide: TENANT_PRISMA, useValue: prisma },
        { provide: StockService, useValue: stock },
        {
          provide: SaleService,
          useValue: { findOne: jest.fn().mockResolvedValue({ id: SALE }) },
        },
      ],
    }).compile();

    service = module.get(SaleReturnService);
  });

  const takeBack = (dto: Partial<CreateReturnDto> = {}) =>
    TenantContext.run(
      { organizationId: ORG, orgRole: OrgRole.owner, userId: 'user-1' },
      () =>
        service.create(SALE, {
          lines: [{ saleLineId: LINE, quantity: 1 }],
          ...dto,
        } as CreateReturnDto),
    );

  /** Every `saleReturn.create` the run made, in order. */
  const writtenReturns = () => {
    const calls = tx.saleReturn.create.mock.calls as [
      { data: Record<string, unknown> },
    ][];
    return calls.map((call) => call[0].data);
  };

  const writtenReturn = () => writtenReturns()[0];

  /** Every `recordInbound` the run made, in order. */
  const restocked = () => {
    const calls = stock.recordInbound.mock.calls as [Record<string, unknown>][];
    return calls.map((call) => call[0]);
  };

  it('puts the goods back into the lot they came out of', async () => {
    await takeBack();

    expect(stock.recordInbound).toHaveBeenCalledTimes(1);
    expect(stock.recordInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: PRODUCT,
        locationId: LOCATION,
        batchId: 'batch-long-dated',
        quantity: 24,
        type: StockMovementType.return_in,
        referenceType: 'sale_return',
      }),
      tx,
    );
  });

  it('spills into the next lot when more comes back than one held', async () => {
    await takeBack({ lines: [{ saleLineId: LINE, quantity: 2 }] });

    expect(restocked()).toEqual([
      expect.objectContaining({ batchId: 'batch-long-dated', quantity: 24 }),
      expect.objectContaining({ batchId: 'batch-short-dated', quantity: 24 }),
    ]);
  });

  it('refunds the share of what was actually charged', async () => {
    await takeBack();

    expect(writtenReturn()).toMatchObject({
      quantity: 24,
      refundAmount: 5_400_000,
      costAmount: 1_800_000,
    });
  });

  it('refunds the whole line to the kobo when all of it comes back', async () => {
    await takeBack({ lines: [{ saleLineId: LINE, quantity: 2 }] });

    expect(writtenReturn()).toMatchObject({
      refundAmount: SOLD_LINE.lineTotal,
      costAmount: SOLD_LINE.costOfGoodsSold,
    });
  });

  it('refunds broken goods without restocking them', async () => {
    await takeBack({
      lines: [
        {
          saleLineId: LINE,
          quantity: 1,
          restocked: false,
          reason: 'Crushed in the boot.',
        },
      ],
    });

    expect(stock.recordInbound).not.toHaveBeenCalled();
    expect(writtenReturn()).toMatchObject({
      restocked: false,
      refundAmount: 5_400_000,
    });
  });

  it('ties the lines handed back in one visit together', async () => {
    await takeBack({
      lines: [
        { saleLineId: LINE, quantity: 1 },
        { saleLineId: LINE, quantity: 1 },
      ],
    });

    const [first, second] = writtenReturns();
    expect(first.returnGroupId).toBe(second.returnGroupId);
    expect(first.returnGroupId).toBeDefined();
  });

  it('refuses to take back more than was sold', async () => {
    await expect(
      takeBack({ lines: [{ saleLineId: LINE, quantity: 3 }] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('counts what has already come back', async () => {
    prisma.sale.findFirst.mockResolvedValue({
      id: SALE,
      locationId: LOCATION,
      lines: [SOLD_LINE],
      returns: [{ saleLineId: LINE, quantity: 24, refundAmount: 5_400_000 }],
    });

    await expect(
      takeBack({ lines: [{ saleLineId: LINE, quantity: 2 }] }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(takeBack()).resolves.toBeDefined();
  });

  it('refuses a line that belongs to another sale', async () => {
    await expect(
      takeBack({ lines: [{ saleLineId: 'line-elsewhere', quantity: 1 }] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
