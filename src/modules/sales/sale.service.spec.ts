import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { OrgRole, PaymentMethod, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { LocationService } from '../inventory/location.service';
import { StockService } from '../inventory/stock.service';
import { SaleService } from './sale.service';
import { CreateSaleDto } from './dto/create-sale.dto';

const ORG = 'org-aaa';
const PRODUCT = 'product-1';
const LOCATION = 'location-1';
const PIECE = 'unit-piece';
const CARTON = 'unit-carton';
const RETAIL = 'tier-retail';
const WHOLESALE = 'tier-wholesale';

/** ₦54,000 a carton, tax-inclusive. */
const CARTON_PRICE = 5_400_000;
/** The same carton, cheaper, for customers on the wholesale list. */
const WHOLESALE_PRICE = 4_800_000;

describe('SaleService', () => {
  let service: SaleService;
  let stock: { recordOutbound: jest.Mock; costOf: jest.Mock };
  let tx: {
    sale: { create: jest.Mock; findMany: jest.Mock };
    saleLine: { createMany: jest.Mock };
    payment: { create: jest.Mock };
    paymentAllocation: { create: jest.Mock };
    organization: { update: jest.Mock };
  };
  let prisma: {
    product: { findFirst: jest.Mock };
    customer: { findFirst: jest.Mock };
    priceTier: { findFirst: jest.Mock };
    sale: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      sale: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      saleLine: { createMany: jest.fn().mockResolvedValue({}) },
      payment: { create: jest.fn().mockResolvedValue({}) },
      paymentAllocation: { create: jest.fn().mockResolvedValue({}) },
      organization: {
        // The counter names the *next* number, so a first sale sees 2 here.
        update: jest.fn().mockResolvedValue({ nextSaleNumber: 2 }),
      },
    };

    prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: PRODUCT,
          name: 'Peak Milk 400g',
          trackStock: true,
          taxRateBps: 750,
          basePrice: 250_000,
          prices: [
            { tierId: RETAIL, unitId: CARTON, price: CARTON_PRICE },
            { tierId: WHOLESALE, unitId: CARTON, price: WHOLESALE_PRICE },
          ],
          units: [
            { id: PIECE, name: 'piece', factor: 1 },
            { id: CARTON, name: 'carton', factor: 24 },
          ],
        }),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue({ priceTierId: null }),
      },
      priceTier: { findFirst: jest.fn().mockResolvedValue({ id: RETAIL }) },
      sale: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sale-1',
          total: 0,
          allocations: [],
          returns: [],
        }),
      },
      $transaction: jest
        .fn()
        .mockImplementation((fn: (client: unknown) => unknown) => fn(tx)),
    };

    stock = {
      recordOutbound: jest
        .fn()
        .mockResolvedValue([
          { id: 'movement-1', batchId: 'batch-1', quantity: -48 },
        ]),
      // 48 pieces at ₦375.00 each, exactly.
      costOf: jest.fn().mockResolvedValue({ cost: 1_800_000, estimated: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaleService,
        { provide: TENANT_PRISMA, useValue: prisma },
        { provide: StockService, useValue: stock },
        {
          provide: LocationService,
          useValue: {
            resolveDefaultId: jest.fn().mockResolvedValue(LOCATION),
            assertExists: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(SaleService);
  });

  const sell = (dto: Partial<CreateSaleDto> = {}) =>
    TenantContext.run(
      { organizationId: ORG, orgRole: OrgRole.owner, userId: 'user-1' },
      () =>
        service.create({
          lines: [{ productId: PRODUCT, unitId: CARTON, quantity: 2 }],
          ...dto,
        } as CreateSaleDto),
    );

  /** The lines that `tx.saleLine.createMany` was asked to write. */
  const writtenLines = () => {
    const calls = tx.saleLine.createMany.mock.calls as [
      { data: Record<string, number>[] },
    ][];
    return calls[0][0].data;
  };

  const writtenLine = () => writtenLines()[0];

  const writtenSale = () => {
    const calls = tx.sale.create.mock.calls as [
      { data: Record<string, number> },
    ][];
    return calls[0][0].data;
  };

  const writtenPayment = () => {
    const calls = tx.payment.create.mock.calls as [
      { data: Record<string, unknown> },
    ][];
    return calls[0][0].data;
  };

  const writtenAllocation = () => {
    const calls = tx.paymentAllocation.create.mock.calls as [
      { data: Record<string, unknown> },
    ][];
    return calls[0][0].data;
  };

  it('takes the stock through the ledger rather than touching it directly', async () => {
    await sell();

    // 2 cartons of 24 is 48 pieces; stock is counted in pieces.
    expect(stock.recordOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: PRODUCT,
        locationId: LOCATION,
        quantity: 48,
        type: StockMovementType.sale,
        referenceType: 'sale',
      }),
      tx,
    );
  });

  it('converts to base units once, keeping the factor it used', async () => {
    await sell();

    expect(writtenLine()).toMatchObject({
      quantity: 2,
      unitFactor: 24,
      baseQuantity: 48,
    });
  });

  it('prices from the tier and freezes the tax it implies', async () => {
    await sell();

    expect(writtenLine()).toMatchObject({
      unitPrice: CARTON_PRICE,
      lineTotal: 10_800_000,
      taxRateBps: 750,
    });
    const line = writtenLine();
    expect(line.lineTotal - line.taxAmount + line.taxAmount).toBe(10_800_000);
  });

  it('lets the seller name the price agreed, overriding the tier', async () => {
    await sell({
      lines: [
        {
          productId: PRODUCT,
          unitId: CARTON,
          quantity: 2,
          unitPrice: 4_900_000,
        },
      ],
    });

    // The agreed price wins over the tier's, which would have been ₦54,000.
    expect(writtenLine()).toMatchObject({
      unitPrice: 4_900_000,
      lineTotal: 9_800_000,
    });
  });

  it('records cost of goods sold from the batches that actually left', async () => {
    await sell();

    expect(stock.costOf).toHaveBeenCalledWith(
      [{ id: 'movement-1', batchId: 'batch-1', quantity: -48 }],
      tx,
    );
    expect(writtenLine().costOfGoodsSold).toBe(1_800_000);
  });

  it('rounds cost of goods sold exactly once', async () => {
    // A pick spanning two lots whose exact costs both end in a fraction.
    stock.costOf.mockResolvedValue({ cost: 1_799_999.7, estimated: 0 });
    await sell();

    expect(writtenLine().costOfGoodsSold).toBe(1_800_000);
  });

  it('records cost as fact when every batch had an invoice', async () => {
    await sell();

    expect(writtenLine().costIsEstimated).toBe(false);
  });

  // Goods sold before the delivery they came from was recorded. The cost is
  // the last known rate, and the line says so rather than passing a guess off
  // as a measurement.
  it('flags the line when any of the cost was estimated', async () => {
    stock.costOf.mockResolvedValue({ cost: 1_800_000, estimated: 900_000 });
    await sell();

    expect(writtenLine().costOfGoodsSold).toBe(1_800_000);
    expect(writtenLine().costIsEstimated).toBe(true);
  });

  it('sells a non-stocked item without touching the ledger', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: PRODUCT,
      name: 'Delivery to Ikeja',
      trackStock: false,
      taxRateBps: 750,
      basePrice: 500_000,
      prices: [],
      units: [{ id: PIECE, name: 'service', factor: 1 }],
    });

    await sell({ lines: [{ productId: PRODUCT, quantity: 1 }] });

    expect(stock.recordOutbound).not.toHaveBeenCalled();
    expect(writtenLine().costOfGoodsSold).toBe(0);
  });

  it('gives a walk-in the default tier', async () => {
    await sell();

    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    expect(writtenSale()).toMatchObject({ customerId: null, tierId: RETAIL });
    expect(writtenLine().unitPrice).toBe(CARTON_PRICE);
  });

  it("uses the customer's own tier when they have one", async () => {
    prisma.customer.findFirst.mockResolvedValue({ priceTierId: WHOLESALE });

    await sell({ customerId: 'customer-1' });

    expect(writtenLine().unitPrice).toBe(WHOLESALE_PRICE);
    expect(writtenSale()).toMatchObject({ tierId: WHOLESALE });
  });

  it('falls back to the default tier for a customer without one', async () => {
    await sell({ customerId: 'customer-1' });

    expect(writtenSale()).toMatchObject({ tierId: RETAIL });
  });

  it('numbers the invoice from the organization counter', async () => {
    await sell();

    expect(tx.organization.update).toHaveBeenCalledWith({
      where: { id: ORG },
      data: { nextSaleNumber: { increment: 1 } },
      select: { nextSaleNumber: true },
    });
    expect(writtenSale()).toMatchObject({ number: 'INV-0001' });
  });

  it('pads the invoice number, and keeps growing past four digits', async () => {
    tx.organization.update.mockResolvedValue({ nextSaleNumber: 10_001 });
    await sell();

    expect(writtenSale()).toMatchObject({ number: 'INV-10000' });
  });

  it('banks a counter sale in full, in the same transaction', async () => {
    await sell();

    expect(writtenSale()).toMatchObject({ total: 10_800_000 });
    expect(writtenPayment()).toMatchObject({
      amount: 10_800_000,
      method: PaymentMethod.cash,
    });
    // Allocated to the sale it paid for, so the balance lands on zero.
    expect(writtenAllocation()).toMatchObject({ amount: 10_800_000 });
  });

  it('records a credit sale with no payment at all', async () => {
    await sell({ payment: { amount: 0 } });

    expect(writtenSale()).toMatchObject({ total: 10_800_000 });
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.paymentAllocation.create).not.toHaveBeenCalled();
  });

  it('records a part payment, leaving the rest owed', async () => {
    await sell({
      payment: { amount: 5_000_000, method: PaymentMethod.transfer },
    });

    expect(writtenPayment()).toMatchObject({
      amount: 5_000_000,
      method: PaymentMethod.transfer,
    });
  });

  it('refuses to record more paid than the sale was worth', async () => {
    await expect(
      sell({ payment: { amount: 11_000_000 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a negative payment on a sale', async () => {
    // Money going back out is a return, which reverses the goods too.
    await expect(sell({ payment: { amount: -100 } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sums the lines into the sale totals', async () => {
    await sell({
      lines: [
        { productId: PRODUCT, unitId: CARTON, quantity: 2 },
        { productId: PRODUCT, unitId: PIECE, quantity: 1 },
      ],
    });

    const sale = writtenSale();
    const lines = writtenLines();

    expect(sale.total).toBe(lines[0].lineTotal + lines[1].lineTotal);
    expect(sale.taxTotal).toBe(lines[0].taxAmount + lines[1].taxAmount);
    expect(sale.costTotal).toBe(
      lines[0].costOfGoodsSold + lines[1].costOfGoodsSold,
    );
  });

  it('lets the ledger refuse a sale it cannot cover', async () => {
    // The policy lives in StockService, not here — this only proves selling
    // does not route around it.
    stock.recordOutbound.mockRejectedValue(
      new ConflictException('Not enough stock'),
    );

    await expect(sell()).rejects.toBeInstanceOf(ConflictException);
    expect(tx.sale.create).not.toHaveBeenCalled();
  });

  it('passes an owner override through to the ledger', async () => {
    await sell({ force: true, forcedReason: 'Sold from the van.' });

    expect(stock.recordOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        force: true,
        forcedReason: 'Sold from the van.',
      }),
      tx,
    );
  });

  describe('clearing what is owed before taking more credit', () => {
    const CUSTOMER = 'customer-1';

    /** One unpaid ₦108,000 invoice already on this customer's account. */
    const owes = () =>
      tx.sale.findMany.mockResolvedValue([
        {
          number: 'INV-0001',
          total: 10_800_000,
          allocations: [],
          returns: [],
        },
      ]);

    const sellOnCredit = (
      dto: Partial<CreateSaleDto> = {},
      role: OrgRole = OrgRole.owner,
    ) =>
      TenantContext.run(
        { organizationId: ORG, orgRole: role, userId: 'user-1' },
        () =>
          service.create({
            customerId: CUSTOMER,
            payment: { amount: 0 },
            lines: [{ productId: PRODUCT, unitId: CARTON, quantity: 2 }],
            ...dto,
          } as CreateSaleDto),
      );

    it('allows credit to a customer who owes nothing', async () => {
      await sellOnCredit();
      expect(tx.sale.create).toHaveBeenCalled();
    });

    it('refuses a second credit sale while the first is unpaid', async () => {
      owes();

      await expect(sellOnCredit()).rejects.toBeInstanceOf(ConflictException);
      expect(tx.sale.create).not.toHaveBeenCalled();
    });

    it('names what is owed, so the counter can say why', async () => {
      owes();

      await expect(sellOnCredit()).rejects.toThrow(/10800000/);
      await expect(sellOnCredit()).rejects.toThrow(/INV-0001/);
    });

    // Paying in full is never blocked: the rule is about *credit*, not about
    // customers who happen to owe money buying something else for cash.
    it('lets the same customer buy for cash', async () => {
      owes();

      await TenantContext.run(
        { organizationId: ORG, orgRole: OrgRole.sales_rep, userId: 'user-1' },
        () =>
          service.create({
            customerId: CUSTOMER,
            lines: [{ productId: PRODUCT, unitId: CARTON, quantity: 2 }],
          } as CreateSaleDto),
      );

      expect(tx.sale.create).toHaveBeenCalled();
    });

    it('lets an owner override it, and records the reason on the sale', async () => {
      owes();

      await sellOnCredit({
        creditOverrideReason: 'Paying both on Friday.',
      });

      const [[args]] = tx.sale.create.mock.calls as [
        { data: { creditOverrideReason: string } },
      ][];
      expect(args.data.creditOverrideReason).toBe('Paying both on Friday.');
    });

    it('refuses that override to a sales rep', async () => {
      owes();

      await expect(
        sellOnCredit(
          { creditOverrideReason: 'Customer insisted.' },
          OrgRole.sales_rep,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.sale.create).not.toHaveBeenCalled();
    });

    // A customer the business owes money to is not in debt, and blocking their
    // next purchase over it would be nonsense.
    it('ignores a negative balance from goods returned after payment', async () => {
      tx.sale.findMany.mockResolvedValue([
        {
          number: 'INV-0001',
          total: 10_800_000,
          allocations: [{ amount: 10_800_000 }],
          returns: [{ refundAmount: 5_000_000 }],
        },
      ]);

      await sellOnCredit();
      expect(tx.sale.create).toHaveBeenCalled();
    });

    it('does not ask about credit for a walk-in with no account', async () => {
      owes();

      await TenantContext.run(
        { organizationId: ORG, orgRole: OrgRole.sales_rep, userId: 'user-1' },
        () =>
          service.create({
            payment: { amount: 0 },
            lines: [{ productId: PRODUCT, unitId: CARTON, quantity: 2 }],
          } as CreateSaleDto),
      );

      expect(tx.sale.findMany).not.toHaveBeenCalled();
      expect(tx.sale.create).toHaveBeenCalled();
    });
  });
});
