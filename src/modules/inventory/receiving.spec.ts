import { Test, TestingModule } from '@nestjs/testing';
import { OrgRole, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { ReceivingService } from './receiving.service';
import { LocationService } from './location.service';
import { SupplierService } from './supplier.service';
import { StockService } from './stock.service';
import { BankAccountService } from '../payments/bank-account.service';
import { SupplierPaymentService } from '../payables/supplier-payment.service';

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
  let supplierPayments: { recordForDelivery: jest.Mock };
  let tx: {
    goodsReceipt: { create: jest.Mock };
    goodsReceiptLine: { create: jest.Mock };
    stockBatch: { create: jest.Mock };
    product: { update: jest.Mock };
    supplierBill: { create: jest.Mock };
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
      // Every delivery now raises the bill for it, whether or not anything was
      // paid: an unpaid delivery is a debt, and GET /payables has to see it.
      supplierBill: { create: jest.fn().mockResolvedValue({ id: 'bill-1' }) },
    };

    prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: PRODUCT,
          name: 'Lotion 200ml',
          variants: [],
          trackStock: true,
          units: [
            { id: PIECE, name: 'piece', factor: 1 },
            { id: CARTON, name: 'carton', factor: 24 },
          ],
        }),
      },
      goodsReceipt: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'receipt-1', lines: [], corrections: [] }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation((fn: (client: unknown) => unknown) => fn(tx)),
    };

    stock = {
      recordInbound: jest.fn().mockResolvedValue({ id: 'movement-1' }),
    };

    supplierPayments = {
      recordForDelivery: jest.fn().mockResolvedValue({ id: 'sp-1' }),
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
        // A delivery raises the bill for it, and may bank the money handed over
        // at the door. Which account that money left from is BankAccountService's
        // rule and is covered there.
        {
          provide: BankAccountService,
          useValue: { resolveForPayment: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: SupplierPaymentService,
          useValue: { recordForDelivery: supplierPayments.recordForDelivery },
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
      corrections: [],
    });

    const receipt = await TenantContext.run(
      { organizationId: ORG, orgRole: OrgRole.owner },
      () => service.findOne('receipt-1'),
    );

    expect(receipt.lines[0].unitCost).toBeCloseTo(INVOICE_TOTAL / 480, 6);
  });

  it('withholds what the delivery cost from a rep', async () => {
    prisma.goodsReceipt.findFirst.mockResolvedValue({
      id: 'receipt-1',
      lines: [{ totalCost: INVOICE_TOTAL, quantityReceived: 480 }],
      corrections: [],
    });

    const receipt = await TenantContext.run(
      { organizationId: ORG, orgRole: OrgRole.sales_rep },
      () => service.findOne('receipt-1'),
    );

    // A goods receipt is the vendor's invoice. The quantities stay — whoever
    // recorded the delivery has to be able to check them — but the price the
    // business negotiated is not theirs to read.
    expect(receipt.lines[0].quantityReceived).toBe(480);
    expect(receipt.lines[0]).not.toHaveProperty('totalCost');
    expect(receipt.lines[0]).not.toHaveProperty('unitCost');
  });

  describe('a product with options (2026-10-08)', () => {
    const GOLD = 'variant-gold';
    beforeEach(() => {
      prisma.product.findFirst.mockResolvedValue({
        id: PRODUCT,
        name: 'Eva Soap',
        trackStock: true,
        variants: [
          { id: GOLD, name: 'Gold', isActive: true },
          { id: 'variant-classic', name: 'Classic', isActive: true },
        ],
        units: [
          { id: PIECE, name: 'piece', factor: 1 },
          { id: CARTON, name: 'carton', factor: 24 },
        ],
      });
    });

    const receiveGold = (variantId?: string) =>
      TenantContext.run({ organizationId: ORG, orgRole: OrgRole.owner }, () =>
        service.create({
          supplierId: SUPPLIER,
          lines: [
            {
              productId: PRODUCT,
              variantId,
              unitId: CARTON,
              quantityReceived: 2,
              totalCost: 4_800_000,
            },
          ],
        }),
      );

    it('puts the option on the line and the movement, never the lot', async () => {
      await receiveGold(GOLD);

      expect(tx.goodsReceiptLine.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ variantId: GOLD }) as object,
      });
      expect(stock.recordInbound).toHaveBeenCalledWith(
        expect.objectContaining({ variantId: GOLD, quantity: 48 }),
        tx,
      );
      const [[{ data: lot }]] = tx.stockBatch.create.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];
      expect(lot).not.toHaveProperty('variantId');
    });

    it('asks which option before anything is written', async () => {
      await expect(receiveGold()).rejects.toThrow(/comes in options/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('a delivery fee (2026-10-09)', () => {
    const OWNER = 'user-owner';
    const STOREKEEPER = 'user-store';

    /** 10 pieces at ₦100,000 and 5 at ₦50,000; the driver took ₦5,000. */
    const receiveWithFee = (
      fee: Record<string, unknown> = { amount: 500_000 },
      orgRole: OrgRole = OrgRole.owner,
    ) =>
      TenantContext.run({ organizationId: ORG, orgRole, userId: OWNER }, () =>
        service.create({
          supplierId: SUPPLIER,
          deliveryFee: fee as never,
          lines: [
            {
              productId: PRODUCT,
              unitId: PIECE,
              quantityReceived: 10,
              totalCost: 10_000_000,
            },
            {
              productId: PRODUCT,
              unitId: PIECE,
              quantityReceived: 5,
              totalCost: 5_000_000,
            },
          ],
        }),
      );

    beforeEach(() => {
      (prisma as unknown as Record<string, unknown>).membership = {
        findFirst: jest.fn().mockResolvedValue({ id: 'membership-1' }),
      };
    });

    it('splits the fee by value onto the lots, and keeps the invoice on the line', async () => {
      await receiveWithFee();

      const lots = tx.stockBatch.create.mock.calls.map(
        ([call]: [{ data: { totalCost: number } }]) => call.data.totalCost,
      );
      // ₦100,000 carries two thirds of ₦5,000, ₦50,000 one third.
      expect(lots).toEqual([10_333_333, 5_166_667]);

      const lines = tx.goodsReceiptLine.create.mock.calls.map(
        ([call]: [{ data: { totalCost: number; deliveryCost: number } }]) => [
          call.data.totalCost,
          call.data.deliveryCost,
        ],
      );
      expect(lines).toEqual([
        [10_000_000, 333_333],
        [5_000_000, 166_667],
      ]);
    });

    it('never puts the fee on the vendor’s bill', async () => {
      await receiveWithFee();

      expect(tx.supplierBill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amountDue: 15_000_000 }) as object,
      });
    });

    it('works the cost price out with the fee in it: ₦10,000 each becomes ₦10,333', async () => {
      await receiveWithFee();

      const [[{ data }]] = tx.product.update.mock.calls as [
        [{ data: { costPrice: number } }],
      ];
      expect(data.costPrice).toBe(Math.round(10_333_333 / 10));
    });

    it('stores the fee on the delivery, paid from the cash of whoever recorded it', async () => {
      await receiveWithFee({ amount: 500_000, paidTo: ' Musa ' });

      expect(tx.goodsReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deliveryFee: 500_000,
          deliveryFeeMethod: 'cash',
          deliveryFeeBankAccountId: null,
          deliveryFeePaidTo: 'Musa',
          deliveryFeePaidByUserId: OWNER,
        }) as object,
      });
    });

    it('names nobody’s cash for a fee paid by transfer', async () => {
      await expect(
        receiveWithFee({
          amount: 500_000,
          method: 'transfer',
          paidByUserId: STOREKEEPER,
        }),
      ).rejects.toThrow(/did not come out of anybody's cash/);

      await receiveWithFee({ amount: 500_000, method: 'transfer' });
      expect(tx.goodsReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deliveryFeeMethod: 'transfer',
          deliveryFeePaidByUserId: null,
        }) as object,
      });
    });

    it('refuses a fee from a storekeeper — it is a cost', async () => {
      await expect(
        receiveWithFee({ amount: 500_000 }, OrgRole.storekeeper),
      ).rejects.toThrow(/Only an owner, manager or accountant/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('withholds the fee and each share from a rep', async () => {
      prisma.goodsReceipt.findFirst.mockResolvedValue({
        id: 'receipt-1',
        deliveryFee: 500_000,
        deliveryFeeMethod: 'cash',
        deliveryFeeBankAccountId: null,
        deliveryFeePaidTo: 'Musa',
        deliveryFeePaidByUserId: OWNER,
        deliveryFeeBankAccount: null,
        deliveryFeePaidBy: { id: OWNER, firstName: 'Ade', lastName: null },
        lines: [
          {
            totalCost: 10_000_000,
            deliveryCost: 500_000,
            quantityReceived: 10,
          },
        ],
        corrections: [],
      });

      const asOwner = await TenantContext.run(
        { organizationId: ORG, orgRole: OrgRole.owner },
        () => service.findOne('receipt-1'),
      );
      expect(asOwner.lines[0].unitCost).toBe(1_000_000);
      expect(asOwner.lines[0].unitCostWithDelivery).toBe(1_050_000);

      const asRep = await TenantContext.run(
        { organizationId: ORG, orgRole: OrgRole.sales_rep },
        () => service.findOne('receipt-1'),
      );
      for (const field of [
        'deliveryFee',
        'deliveryFeeMethod',
        'deliveryFeePaidTo',
        'deliveryFeePaidBy',
      ]) {
        expect(asRep).not.toHaveProperty(field);
      }
      expect(asRep.lines[0]).not.toHaveProperty('deliveryCost');
      expect(asRep.lines[0]).not.toHaveProperty('unitCostWithDelivery');
    });
  });
});
