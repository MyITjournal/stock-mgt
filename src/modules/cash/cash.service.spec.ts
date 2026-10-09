import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { BankAccountService } from '../payments/bank-account.service';
import { CashService } from './cash.service';
import { CreateCashBankingDto } from './dto/cash-banking.dto';

const ORG = 'org-aaa';
const OWNER = 'user-owner';
const MANAGER = 'user-manager';
const REP = 'user-rep';
const OTHER_REP = 'user-rep-2';
const ACCOUNT = 'account-1';

/**
 * The rules that make the screen worth trusting: staff bank only their own,
 * nobody confirms their own, and nobody banks more than they hold. The
 * arithmetic itself is in cash.spec.ts; smoke walks it end to end.
 */
describe('CashService', () => {
  let service: CashService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  /** What each person took in cash, as the payments groupBy reports it. */
  let takings: Record<string, number>;
  /** The row `findFirst` hands back — the banking being confirmed. */
  let stored: Record<string, unknown>;

  beforeEach(async () => {
    takings = {
      [REP]: 50_000_00,
      [OTHER_REP]: 20_000_00,
      [MANAGER]: 10_000_00,
    };
    stored = {};

    prisma = {
      payment: {
        groupBy: jest
          .fn()
          .mockImplementation(
            (args: {
              where: { amount: { gt?: number }; recordedByUserId: unknown };
            }) => {
              if (args.where.amount.gt === undefined) return [];
              const who = args.where.recordedByUserId;
              return Object.entries(takings)
                .filter(([id]) => typeof who !== 'string' || id === who)
                .map(([id, amount]) => ({
                  recordedByUserId: id,
                  _sum: { amount },
                }));
            },
          ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      expense: { groupBy: jest.fn().mockResolvedValue([]) },
      supplierPayment: { groupBy: jest.fn().mockResolvedValue([]) },
      goodsReceipt: { groupBy: jest.fn().mockResolvedValue([]) },
      cashBanking: {
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockImplementation(() => ({
          id: 'banking-1',
          heldBy: { id: REP, firstName: 'Bola', lastName: null },
          amount: 10_000_00,
          bankAccount: null,
          reference: null,
          note: null,
          occurredAt: new Date(),
          recordedBy: null,
          confirmedAt: null,
          confirmedBy: null,
          voidedAt: null,
          voidedReason: null,
          voidedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...stored,
        })),
      },
      membership: { findFirst: jest.fn().mockResolvedValue({ id: 'm' }) },
      organization: {
        findFirst: jest.fn().mockResolvedValue({
          cashCountedFrom: null,
          timezone: 'Africa/Lagos',
          currency: 'NGN',
        }),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashService,
        { provide: TENANT_PRISMA, useValue: prisma },
        {
          provide: BankAccountService,
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: ACCOUNT,
              isActive: true,
              bankName: 'GTBank',
              accountNumber: '0123456789',
            }),
          },
        },
      ],
    }).compile();

    service = module.get(CashService);
  });

  const as = <T>(userId: string, orgRole: OrgRole, fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: ORG, userId, orgRole }, fn);

  const bank = (dto: Partial<CreateCashBankingDto> = {}) =>
    ({
      amount: 10_000_00,
      to: 'bank',
      bankAccountId: ACCOUNT,
      ...dto,
    }) as CreateCashBankingDto;

  const written = () =>
    (
      prisma.cashBanking.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ]
    )[0].data;

  describe('recording', () => {
    it('lets staff bank their own, and leaves it waiting', async () => {
      await as(REP, OrgRole.sales_rep, () => service.create(bank()));

      expect(written()).toMatchObject({
        heldByUserId: REP,
        recordedByUserId: REP,
      });
      expect(written().confirmedAt).toBeUndefined();
    });

    it('refuses staff banking somebody else’s cash', async () => {
      await expect(
        as(REP, OrgRole.sales_rep, () =>
          service.create(bank({ heldByUserId: OTHER_REP })),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.cashBanking.create).not.toHaveBeenCalled();
    });

    it('confirms a manager’s record for somebody else as it is written', async () => {
      await as(MANAGER, OrgRole.manager, () =>
        service.create(bank({ heldByUserId: REP })),
      );
      expect(written()).toMatchObject({
        heldByUserId: REP,
        confirmedByUserId: MANAGER,
      });
    });

    it('leaves a manager’s own banking waiting for somebody else', async () => {
      await as(MANAGER, OrgRole.manager, () => service.create(bank()));
      expect(written().confirmedAt).toBeUndefined();
    });

    it('confirms the owner’s own at once — nobody is above them', async () => {
      takings[OWNER] = 30_000_00;
      await as(OWNER, OrgRole.owner, () => service.create(bank()));
      expect(written()).toMatchObject({ confirmedByUserId: OWNER });
    });

    it('refuses more than the person holds, as MORE_THAN_HELD', async () => {
      const attempt = as(REP, OrgRole.sales_rep, () =>
        service.create(bank({ amount: 50_000_01 })),
      );
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await attempt.catch((error: ConflictException) =>
        expect(error.getResponse()).toMatchObject({
          error: 'MORE_THAN_HELD',
          stillHolding: 50_000_00,
        }),
      );
    });

    it('counts waiting banking against what can still be banked', async () => {
      prisma.cashBanking.groupBy.mockResolvedValue([
        { heldByUserId: REP, confirmedAt: null, _sum: { amount: 45_000_00 } },
      ]);
      await expect(
        as(REP, OrgRole.sales_rep, () =>
          service.create(bank({ amount: 6_000_00 })),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('counts a delivery fee paid from their cash as paid out', async () => {
      // ₦50,000 taken, ₦5,000 of it handed to a driver: ₦45,000 is left.
      prisma.goodsReceipt.groupBy.mockResolvedValue([
        { deliveryFeePaidByUserId: REP, _sum: { deliveryFee: 5_000_00 } },
      ]);
      await expect(
        as(REP, OrgRole.sales_rep, () =>
          service.create(bank({ amount: 45_000_01 })),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      await as(REP, OrgRole.sales_rep, () =>
        service.create(bank({ amount: 45_000_00 })),
      );

      const [query] = prisma.goodsReceipt.groupBy.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(query.where).toMatchObject({
        deliveryFeeMethod: 'cash',
        deliveryFee: { gt: 0 },
      });
    });

    it('needs an account for the bank, and refuses one for the owner', async () => {
      await expect(
        as(REP, OrgRole.sales_rep, () =>
          service.create(bank({ bankAccountId: undefined })),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        as(REP, OrgRole.sales_rep, () => service.create(bank({ to: 'owner' }))),
      ).rejects.toBeInstanceOf(BadRequestException);

      await as(REP, OrgRole.sales_rep, () =>
        service.create(bank({ to: 'owner', bankAccountId: undefined })),
      );
      expect(written().bankAccountId).toBeNull();
    });
  });

  describe('confirming', () => {
    it('refuses a manager confirming their own', async () => {
      stored = { heldBy: { id: MANAGER, firstName: 'M', lastName: null } };
      await expect(
        as(MANAGER, OrgRole.manager, () => service.confirm('banking-1')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a manager confirm a colleague’s', async () => {
      await as(MANAGER, OrgRole.manager, () => service.confirm('banking-1'));
      const [call] = prisma.cashBanking.update.mock.calls as [
        { data: Record<string, unknown> },
      ][];
      expect(call[0].data).toMatchObject({ confirmedByUserId: MANAGER });
    });

    it('refuses confirming twice, as ALREADY_CONFIRMED', async () => {
      stored = { confirmedAt: new Date() };
      const attempt = as(OWNER, OrgRole.owner, () =>
        service.confirm('banking-1'),
      );
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await attempt.catch((error: ConflictException) =>
        expect(error.getResponse()).toMatchObject({
          error: 'ALREADY_CONFIRMED',
        }),
      );
    });
  });

  describe('the summary', () => {
    it('shows staff only themselves', async () => {
      const view = await as(REP, OrgRole.sales_rep, () => service.summary());
      expect(view.people.map((person) => person.userId)).toEqual([REP]);
    });

    it('shows a manager everybody, most held first', async () => {
      const view = await as(MANAGER, OrgRole.manager, () => service.summary());
      expect(view.people.map((person) => person.userId)).toEqual([
        REP,
        OTHER_REP,
        MANAGER,
      ]);
      expect(view.totals.notBanked).toBe(80_000_00);
    });
  });
});
