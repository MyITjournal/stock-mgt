import { OrgRole, SalePrintKind } from '@prisma/client';
import { TenantContext } from '../../common/tenancy/tenant-context';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import type { OrganizationService } from '../organization/organization.service';
import type { ReceivableService } from '../payments/receivable.service';
import type { SaleService } from '../sales/sale.service';
import { DocumentService } from './document.service';

/** The private counter, reached the way a test may and the app may not. */
type CopyCounter = {
  recordCopy(
    saleId: string,
    kind: SalePrintKind,
  ): Promise<{ number: number; madeAt: Date }>;
};

describe('DocumentService — counting copies (2026-10-09)', () => {
  const madeAt = new Date('2026-10-09T13:02:00.000Z');
  let salePrint: { findFirst: jest.Mock; create: jest.Mock };
  let counter: CopyCounter;

  beforeEach(() => {
    salePrint = { findFirst: jest.fn(), create: jest.fn() };
    const service = new DocumentService(
      { salePrint } as unknown as TenantPrisma,
      {} as OrganizationService,
      {} as SaleService,
      {} as ReceivableService,
    );
    counter = service as unknown as CopyCounter;
  });

  const record = () =>
    TenantContext.run(
      { organizationId: 'org-1', userId: 'user-1', orgRole: OrgRole.sales_rep },
      () => counter.recordCopy('sale-1', SalePrintKind.printed),
    );

  it('makes the first copy number 1, and records who made it', async () => {
    salePrint.findFirst.mockResolvedValue(null);
    salePrint.create.mockResolvedValue({ copy: 1, createdAt: madeAt });

    await expect(record()).resolves.toEqual({ number: 1, madeAt });
    expect(salePrint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          organizationId: 'org-1',
          saleId: 'sale-1',
          copy: 1,
          kind: SalePrintKind.printed,
          printedByUserId: 'user-1',
        },
      }),
    );
  });

  it('takes the next number when another copy got there first', async () => {
    // Both read copy 1 as the last; the other one wins copy 2.
    salePrint.findFirst
      .mockResolvedValueOnce({ copy: 1 })
      .mockResolvedValueOnce({ copy: 2 });
    salePrint.create
      .mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      )
      .mockResolvedValueOnce({ copy: 3, createdAt: madeAt });

    await expect(record()).resolves.toEqual({ number: 3, madeAt });
    const tried = salePrint.create.mock.calls as [{ data: { copy: number } }][];
    expect(tried.map(([args]) => args.data.copy)).toEqual([2, 3]);
  });

  it('does not swallow any other failure', async () => {
    salePrint.findFirst.mockResolvedValue(null);
    salePrint.create.mockRejectedValue(new Error('connection lost'));

    await expect(record()).rejects.toThrow('connection lost');
    expect(salePrint.create).toHaveBeenCalledTimes(1);
  });
});
