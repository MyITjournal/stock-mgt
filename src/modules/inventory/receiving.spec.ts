import { Test, TestingModule } from '@nestjs/testing';
import { OrgRole, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { ReceivingService } from './receiving.service';
import { LocationService } from './location.service';
import { SupplierService } from './supplier.service';
import { StockService } from './stock.service';

const ORG = 'org-aaa';
const PRODUCT = 'product-1';
const SUPPLIER = 'supplier-1';
const LOCATION = 'location-1';
const CARTON = 'unit-carton';
const PIECE = 'unit-piece';

/**
 * The worked example from §2 of the decisions doc: 19 cartons paid for, 20
 * delivered, ₦949,449 on the invoice. In kobo, and in cartons of 24.
 */
const INVOICE_TOTAL = 94944900;

describe('ReceivingService', () => {
  let service: ReceivingService;
  let stock: { recordInbound: jest.Mock };
  let tx: {
    goodsReceipt: { create: jest.Mock };
    goodsReceiptLine: { create: jest.Mock };
    stockBatch: { create: jest.Mock };
    product: { update: jest.Mock };
  };
  let prisma: {
    product: { findFirst: jest.Mock };
    goodsReceipt: { findFirst: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      goodsReceipt: {
        create: jest.fn().mockResolvedValue({ id: 'receipt-1' }),
      },
      goodsReceiptLine: { create: jest.fn().mockResolvedValue({}) },
      stockBatch: { create: jest.fn().mockResolvedValue({ id: 'batch-1' }) },
      product: { update: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: PRODUCT,
          name: 'Lotion 200ml',
          trackStock: true,
          units: [
            { id: PIECE, name: 'piece', factor: 1 },
            { id: CARTON, name: 'carton', factor: 24 },
          ],
        }),
      },
      goodsReceipt: {
        findFirst: jest.fn().mockResolvedValue({ id: 'receipt-1', lines: [] }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation((fn: (client: unknown) => unknown) => fn(tx)),
    };

    stock = {
      recordInbound: jest.fn().mockResolvedValue({ id: 'movement-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceivingService,
        { provide: TENANT_PRISMA, useValue: prisma },
        { provide: StockService, useValue: stock },
        {
          provide: LocationService,
          useValue: {
            resolveDefaultId: jest.fn().mockResolvedValue(LOCATION),
            assertExists: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: SupplierService,
          useValue: { assertExists: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(ReceivingService);
  });

  const receive = () =>
    TenantContext.run({ organizationId: ORG, orgRole: OrgRole.owner }, () =>
      service.create({
        supplierId: SUPPLIER,
        lines: [
          {
            productId: PRODUCT,
            unitId: CARTON,
            quantityReceived: 20,
            quantityPaidFor: 19,
            totalCost: INVOICE_TOTAL,
          },
        ],
      }),
    );

  it('converts cartons to base units once, at write time', async () => {
    await receive();

    // 20 cartons of 24 is 480 pieces; stock is counted in pieces.
    expect(tx.stockBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quantityReceived: 480,
        quantityPaidFor: 456,
      }) as object,
    });
    expect(stock.recordInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 480,
        type: StockMovementType.receipt,
        referenceType: 'goods_receipt',
        referenceId: 'receipt-1',
      }),
      tx,
    );
  });

  it('keeps what was typed, and the factor it was converted with', async () => {
    await receive();

    // A later edit to what a carton contains must not rewrite this delivery.
    expect(tx.goodsReceiptLine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quantityReceivedInUnit: 20,
        quantityPaidForInUnit: 19,
        unitFactor: 24,
        quantityReceived: 480,
        quantityPaidFor: 456,
      }) as object,
    });
  });

  it('stores the invoice total exactly, never a per-unit price', async () => {
    await receive();

    expect(tx.stockBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ totalCost: INVOICE_TOTAL }) as object,
    });
  });

  it('lets the free carton pull the cost of every unit down', async () => {
    await receive();

    // ₦949,449 across 480 pieces — divided by what arrived, not what was paid
    // for, which is the whole point of free goods.
    const [[{ data }]] = tx.product.update.mock.calls as [
      [{ data: { costPrice: number } }],
    ];
    expect(data.costPrice).toBe(Math.round(INVOICE_TOTAL / 480));
    expect(data.costPrice).toBeLessThan(Math.round(INVOICE_TOTAL / 456));
  });

  it('defaults quantityPaidFor to what arrived when the vendor gave nothing free', async () => {
    await TenantContext.run({ organizationId: ORG }, () =>
      service.create({
        supplierId: SUPPLIER,
        lines: [
          {
            productId: PRODUCT,
            unitId: CARTON,
            quantityReceived: 10,
            totalCost: INVOICE_TOTAL,
          },
        ],
      }),
    );

    expect(tx.stockBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quantityReceived: 240,
        quantityPaidFor: 240,
      }) as object,
    });
  });

  it('counts in the base unit when no unit is named', async () => {
    await TenantContext.run({ organizationId: ORG }, () =>
      service.create({
        supplierId: SUPPLIER,
        lines: [
          { productId: PRODUCT, quantityReceived: 12, totalCost: 500000 },
        ],
      }),
    );

    expect(tx.goodsReceiptLine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        unitId: PIECE,
        unitFactor: 1,
        quantityReceived: 12,
      }) as object,
    });
  });

  it('refuses a unit belonging to some other product', async () => {
    await expect(
      TenantContext.run({ organizationId: ORG }, () =>
        service.create({
          supplierId: SUPPLIER,
          lines: [
            {
              productId: PRODUCT,
              unitId: 'unit-from-elsewhere',
              quantityReceived: 1,
              totalCost: 1000,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/does not belong/);
  });

  it('refuses to receive a product that is not stocked', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: PRODUCT,
      name: 'Delivery fee',
      trackStock: false,
      units: [{ id: PIECE, name: 'piece', factor: 1 }],
    });

    await expect(
      TenantContext.run({ organizationId: ORG }, () =>
        service.create({
          supplierId: SUPPLIER,
          lines: [{ productId: PRODUCT, quantityReceived: 1, totalCost: 1000 }],
        }),
      ),
    ).rejects.toThrow(/not stocked/);
  });

  it('reports the implied unit cost on read, rather than storing it', async () => {
    prisma.goodsReceipt.findFirst.mockResolvedValue({
      id: 'receipt-1',
      lines: [{ totalCost: INVOICE_TOTAL, quantityReceived: 480 }],
    });

    const receipt = await TenantContext.run({ organizationId: ORG }, () =>
      service.findOne('receipt-1'),
    );

    expect(receipt.lines[0].unitCost).toBeCloseTo(INVOICE_TOTAL / 480, 6);
  });
});
