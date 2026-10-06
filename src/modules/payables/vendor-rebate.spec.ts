import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { SupplierBillService } from './supplier-bill.service';
import { VendorRebateService } from './vendor-rebate.service';

const ORG = 'org-1';

/**
 * The credit rules that smoke does not reach: a bill from another vendor, and
 * crediting a rebate twice. The happy path, the over-credit refusal and the
 * effect on the bill and on profit are walked against a server in smoke.
 */
describe('crediting a vendor rebate', () => {
  const build = (rebate: object, bill: object, currency = 'NGN') => {
    const tx = {
      organization: {
        findFirst: jest.fn().mockResolvedValue({ currency }),
      },
      vendorRebate: {
        findFirst: jest.fn().mockResolvedValue(rebate),
        update: jest.fn().mockResolvedValue({
          id: 'rebate-1',
          creditedAt: new Date(),
          supplier: { id: 'supplier-1', name: 'Unilever' },
          bill: null,
        }),
      },
      supplierBill: {
        findFirst: jest.fn().mockResolvedValue({ issuedAt: new Date() }),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const bills = {
      balanceOf: jest.fn().mockResolvedValue(bill),
    } as unknown as SupplierBillService;
    const service = new VendorRebateService(prisma as never, bills);
    const run = (amount: number) =>
      TenantContext.run(
        { organizationId: ORG, orgRole: OrgRole.owner, userId: 'user-1' },
        () => service.credit('rebate-1', { billId: 'bill-1', amount }),
      );
    return { run, tx };
  };

  it('refuses a bill from another vendor', async () => {
    const { run, tx } = build(
      { id: 'rebate-1', supplierId: 'supplier-1', creditedAt: null },
      { id: 'bill-1', supplierId: 'supplier-2', balance: 1_000_000 },
    );
    await expect(run(100)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.vendorRebate.update).not.toHaveBeenCalled();
  });

  it('refuses a rebate that is already credited', async () => {
    const { run, tx } = build(
      { id: 'rebate-1', supplierId: 'supplier-1', creditedAt: new Date() },
      { id: 'bill-1', supplierId: 'supplier-1', balance: 1_000_000 },
    );
    await expect(run(100)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.vendorRebate.update).not.toHaveBeenCalled();
  });

  it('refuses more than the bill still owes, naming both in naira', async () => {
    const { run } = build(
      { id: 'rebate-1', supplierId: 'supplier-1', creditedAt: null },
      { id: 'bill-1', supplierId: 'supplier-1', balance: 500_000 },
    );
    await expect(run(600_000)).rejects.toThrow(/₦5,000\.00.*₦6,000\.00/);
  });

  it('names them in the shop’s own currency', async () => {
    const { run } = build(
      { id: 'rebate-1', supplierId: 'supplier-1', creditedAt: null },
      { id: 'bill-1', supplierId: 'supplier-1', balance: 500_000 },
      'GHS',
    );
    await expect(run(600_000)).rejects.toThrow(
      /GHS.?5,000\.00.*GHS.?6,000\.00/,
    );
  });

  it('counts it in the month of the bill it lands on', async () => {
    const issuedAt = new Date('2026-11-03T09:00:00Z');
    const { run, tx } = build(
      { id: 'rebate-1', supplierId: 'supplier-1', creditedAt: null },
      { id: 'bill-1', supplierId: 'supplier-1', balance: 500_000 },
    );
    tx.supplierBill.findFirst.mockResolvedValue({ issuedAt });
    await run(400_000);
    expect(tx.vendorRebate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          billId: 'bill-1',
          creditedAmount: 400_000,
          creditedAt: issuedAt,
        },
      }),
    );
  });
});
