import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole, PaymentMethod } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

const ORG = 'org-aaa';
const CUSTOMER = 'customer-1';
const INV_A = 'sale-a';
const INV_B = 'sale-b';

/** Two unpaid invoices: ₦108,000 from Monday, ₦50,000 from Friday. */
const openInvoices = [
  { id: INV_A, total: 10_800_000, allocations: [], returns: [] },
  { id: INV_B, total: 5_000_000, allocations: [], returns: [] },
];

describe('PaymentService', () => {
  let service: PaymentService;
  let tx: {
    payment: { create: jest.Mock };
    paymentAllocation: { createMany: jest.Mock };
  };
  let prisma: {
    sale: { findMany: jest.Mock };
    customer: { findFirst: jest.Mock };
    payment: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      payment: { create: jest.fn().mockResolvedValue({}) },
      paymentAllocation: { createMany: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      sale: { findMany: jest.fn().mockResolvedValue(openInvoices) },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER }) },
      payment: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'payment-1', amount: 0, allocations: [] }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest
        .fn()
        .mockImplementation((fn: (client: unknown) => unknown) => fn(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentService, { provide: TENANT_PRISMA, useValue: prisma }],
    }).compile();

    service = module.get(PaymentService);
  });

  const pay = (dto: Partial<CreatePaymentDto> = {}) =>
    TenantContext.run(
      { organizationId: ORG, orgRole: OrgRole.accountant, userId: 'user-1' },
      () =>
        service.create({
          customerId: CUSTOMER,
          amount: 5_000_000,
          ...dto,
        } as CreatePaymentDto),
    );

  const writtenPayment = () => {
    const calls = tx.payment.create.mock.calls as [
      { data: Record<string, unknown> },
    ][];
    return calls[0][0].data;
  };

  const writtenAllocations = () => {
    const calls = tx.paymentAllocation.createMany.mock.calls as [
      { data: Record<string, unknown>[] },
    ][];
    return calls.length ? calls[0][0].data : [];
  };

  it('records one payment for what actually hit the bank', async () => {
    await pay({
      amount: 5_000_000,
      method: PaymentMethod.transfer,
      reference: 'FT26083012345',
      allocations: [
        { saleId: INV_A, amount: 3_000_000 },
        { saleId: INV_B, amount: 2_000_000 },
      ],
    });

    // One payment, two claims — not two payments.
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
    expect(writtenPayment()).toMatchObject({
      amount: 5_000_000,
      method: PaymentMethod.transfer,
      reference: 'FT26083012345',
    });
    expect(writtenAllocations()).toHaveLength(2);
  });

  it('settles the oldest invoices first when the caller does not say', async () => {
    await pay({ amount: 12_000_000 });

    expect(writtenAllocations()).toEqual([
      expect.objectContaining({ saleId: INV_A, amount: 10_800_000 }),
      expect.objectContaining({ saleId: INV_B, amount: 1_200_000 }),
    ]);
  });

  it('keeps what no invoice claimed as credit on the customer', async () => {
    // ₦200,000 against ₦158,000 of debt leaves ₦42,000 sitting on the account.
    await pay({ amount: 20_000_000 });

    const allocated = writtenAllocations().reduce(
      (sum, row) => sum + (row.amount as number),
      0,
    );
    expect(allocated).toBe(15_800_000);
    expect(writtenPayment().amount).toBe(20_000_000);
  });

  it('writes no allocation rows when there is nothing outstanding', async () => {
    prisma.sale.findMany.mockResolvedValue([]);

    await pay({ amount: 5_000_000 });

    expect(tx.paymentAllocation.createMany).not.toHaveBeenCalled();
    expect(writtenPayment()).toMatchObject({ amount: 5_000_000 });
  });

  it('refuses an over-allocation with a 409', async () => {
    await expect(
      pay({
        amount: 9_000_000,
        allocations: [{ saleId: INV_B, amount: 6_000_000 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('refuses a payment of nothing', async () => {
    await expect(pay({ amount: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('records a refund as a negative payment against the sale', async () => {
    // The invoice went negative after a return: the shop owes ₦60,000 back.
    prisma.sale.findMany.mockResolvedValue([
      {
        id: INV_A,
        total: 12_000_000,
        allocations: [{ amount: 12_000_000 }],
        returns: [{ refundAmount: 6_000_000 }],
      },
    ]);

    await pay({
      amount: -6_000_000,
      allocations: [{ saleId: INV_A, amount: -6_000_000 }],
    });

    expect(writtenPayment()).toMatchObject({ amount: -6_000_000 });
    expect(writtenAllocations()).toEqual([
      expect.objectContaining({ amount: -6_000_000 }),
    ]);
  });

  it('looks the invoice up by id for a walk-in with no account', async () => {
    await pay({
      customerId: undefined,
      amount: 1_000_000,
      allocations: [{ saleId: INV_A, amount: 1_000_000 }],
    });

    expect(prisma.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [INV_A] } },
      }),
    );
  });

  describe('voiding', () => {
    const voidIt = (reason = 'Keyed 500,000 instead of 50,000.') =>
      TenantContext.run(
        { organizationId: ORG, orgRole: OrgRole.manager, userId: 'user-9' },
        () => service.voidPayment('payment-1', { reason }),
      );

    /** The single `payment.update` a void is expected to have written. */
    const voidWrite = () => {
      const calls = prisma.payment.update.mock.calls as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      return calls[0][0];
    };

    it('records who voided it, when, and why', async () => {
      await voidIt('Booked against the wrong customer.');

      const { where, data } = voidWrite();
      expect(where).toEqual({ id: 'payment-1' });
      expect(data.voidedAt).toBeInstanceOf(Date);
      expect(data.voidedReason).toBe('Booked against the wrong customer.');
      expect(data.voidedByUserId).toBe('user-9');
    });

    it('trims the reason rather than storing the whitespace', async () => {
      await voidIt('   Duplicate entry.   ');

      expect(voidWrite().data.voidedReason).toBe('Duplicate entry.');
    });

    it('flags the row rather than deleting anything', async () => {
      await voidIt();

      // The correction is three fields and nothing else: the payment keeps its
      // amount and its allocations, so what it had claimed stays readable.
      expect(Object.keys(voidWrite().data).sort()).toEqual([
        'voidedAt',
        'voidedByUserId',
        'voidedReason',
      ]);
    });

    it('refuses to void the same payment twice', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        amount: 5_000_000,
        allocations: [],
        voidedAt: new Date('2026-08-30T09:00:00Z'),
      });

      await expect(voidIt()).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('404s on a payment this organization cannot see', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(voidIt()).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
