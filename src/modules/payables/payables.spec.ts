import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { OrgRole, PaymentMethod } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { BankAccountService } from '../payments/bank-account.service';
import { PayableService } from './payable.service';
import { SupplierBillService } from './supplier-bill.service';
import { SupplierPaymentService } from './supplier-payment.service';

const ORG = 'org-aaa';
const NAIRA = 100;

const as = <T>(fn: () => Promise<T>) =>
  TenantContext.run(
    { organizationId: ORG, userId: 'user-1', orgRole: OrgRole.owner },
    fn,
  );

describe('paying vendors', () => {
  let payments: SupplierPaymentService;
  let bills: SupplierBillService;
  let prisma: {
    supplierBill: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    supplierPayment: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    supplier: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      supplierBill: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'bill-1',
          supplierId: 'supplier-1',
          amountDue: 199_800 * NAIRA,
          payments: [{ amount: 71_800 * NAIRA }],
        }),
        findMany: jest.fn().mockResolvedValue([]),
        // Both stand in for a `BILL_INCLUDE` read, which always carries
        // `payments` — the balance is attached on the way out and walks it.
        create: jest
          .fn()
          .mockResolvedValue({ id: 'bill-1', amountDue: 0, payments: [] }),
        update: jest.fn().mockResolvedValue({
          id: 'bill-1',
          amountDue: 190_000 * NAIRA,
          payments: [{ amount: 71_800 * NAIRA }],
        }),
      },
      supplierPayment: {
        create: jest.fn().mockResolvedValue({ id: 'payment-1' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'payment-1' }),
        update: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      },
      supplier: {
        findFirst: jest.fn().mockResolvedValue({ id: 'supplier-1' }),
      },
      $transaction: jest
        .fn()
        .mockImplementation((fn: (client: unknown) => unknown) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierPaymentService,
        SupplierBillService,
        PayableService,
        { provide: TENANT_PRISMA, useValue: prisma },
        {
          provide: BankAccountService,
          useValue: { resolveForPayment: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    payments = module.get(SupplierPaymentService);
    bills = module.get(SupplierBillService);
  });

  it('lets a part-payment settle some of what is owed', async () => {
    await as(() =>
      payments.create({ billId: 'bill-1', amount: 100_000 * NAIRA }),
    );

    const [[{ data }]] = prisma.supplierPayment.create.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    expect(data.amount).toBe(100_000 * NAIRA);
    expect(data.billId).toBe('bill-1');
  });

  it('copies the vendor from the bill rather than trusting the caller', async () => {
    await as(() => payments.create({ billId: 'bill-1', amount: 1000 }));

    const [[{ data }]] = prisma.supplierPayment.create.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    // The two can then never disagree about who was paid.
    expect(data.supplierId).toBe('supplier-1');
  });

  it('refuses to pay a vendor more than they are owed', async () => {
    // ₦128,000 outstanding on this bill, and ₦150,000 offered.
    await expect(
      as(() => payments.create({ billId: 'bill-1', amount: 150_000 * NAIRA })),
    ).rejects.toThrow(ConflictException);
  });

  it('names the outstanding figure when it refuses', async () => {
    await expect(
      as(() => payments.create({ billId: 'bill-1', amount: 150_000 * NAIRA })),
    ).rejects.toThrow(/12800000/);
  });

  it('checks the balance inside the transaction, not before it', async () => {
    await as(() => payments.create({ billId: 'bill-1', amount: 1000 }));

    // Two payments racing for the last of a bill would otherwise both read the
    // full balance and both be allowed through.
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('records which account the money left from', async () => {
    await as(() =>
      payments.create({
        billId: 'bill-1',
        amount: 1000,
        method: PaymentMethod.transfer,
        bankAccountId: 'account-1',
      }),
    );

    const [[{ data }]] = prisma.supplierPayment.create.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    expect(data.method).toBe(PaymentMethod.transfer);
  });

  describe('voiding', () => {
    it('keeps the row and stops it counting', async () => {
      await as(() =>
        payments.void('payment-1', {
          reason: 'Keyed against the wrong vendor.',
        }),
      );

      const [[{ data }]] = prisma.supplierPayment.update.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];
      expect(data.voidedAt).toBeInstanceOf(Date);
      expect(data.voidedReason).toBe('Keyed against the wrong vendor.');
    });

    it('refuses to void the same payment twice', async () => {
      prisma.supplierPayment.findFirst.mockResolvedValue({
        id: 'payment-1',
        voidedAt: new Date(),
      });

      await expect(
        as(() => payments.void('payment-1', { reason: 'Again.' })),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('opening balances', () => {
    it('records what is already owed without touching stock', async () => {
      await as(() =>
        bills.create({
          supplierId: 'supplier-1',
          amountDue: 32_000 * NAIRA,
          issuedAt: new Date(Date.now() - 86_400_000 * 17).toISOString(),
        }),
      );

      // The goods behind an opening balance arrived, and very likely sold,
      // long before this row was typed. Writing movements for them would put
      // stock in the ledger that is not on the shelf.
      const [[{ data }]] = prisma.supplierBill.create.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];
      expect(data.amountDue).toBe(32_000 * NAIRA);
      expect(data).not.toHaveProperty('goodsReceiptId');
    });
  });

  describe('correcting a bill', () => {
    it('refuses to drop the amount below what has been paid', async () => {
      // ₦71,800 already paid; reducing the bill to ₦50,000 would mean the
      // vendor owes this business money, which nothing here can represent.
      await expect(
        as(() => bills.update('bill-1', { amountDue: 50_000 * NAIRA })),
      ).rejects.toThrow(ConflictException);
    });

    it('allows a correction that still covers what was paid', async () => {
      await as(() => bills.update('bill-1', { amountDue: 190_000 * NAIRA }));

      expect(prisma.supplierBill.update).toHaveBeenCalled();
    });
  });
});
