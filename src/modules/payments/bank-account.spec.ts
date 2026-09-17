import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentMethod } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { BankAccountService } from './bank-account.service';

const ORG = 'org-aaa';
const GTB = {
  id: 'acct-gtb',
  bankName: 'Guaranty Trust Bank',
  accountNumber: '0123456789',
  isActive: true,
};

describe('BankAccountService', () => {
  let service: BankAccountService;
  let prisma: {
    bankAccount: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    payment: { count: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      bankAccount: {
        create: jest.fn().mockResolvedValue({ ...GTB, isDefault: false }),
        findFirst: jest.fn().mockResolvedValue(GTB),
        findMany: jest.fn().mockResolvedValue([GTB]),
        update: jest.fn().mockResolvedValue({ ...GTB, isDefault: false }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      payment: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankAccountService,
        { provide: TENANT_PRISMA, useValue: prisma },
      ],
    }).compile();

    service = module.get(BankAccountService);
  });

  const asOrg = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: ORG }, fn);

  describe('which payments must name an account', () => {
    it('requires one for a transfer', async () => {
      await expect(
        asOrg(() => service.resolveForPayment(PaymentMethod.transfer)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires one for a POS payment, which settles into an account too', async () => {
      await expect(
        asOrg(() => service.resolveForPayment(PaymentMethod.pos)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('says to set accounts up when the business has none', async () => {
      prisma.bankAccount.findMany.mockResolvedValue([]);

      await expect(
        asOrg(() => service.resolveForPayment(PaymentMethod.transfer)),
      ).rejects.toThrow(/Set your accounts up first/);
    });

    it('refuses one on a cash payment, which never reached a bank', async () => {
      await expect(
        asOrg(() => service.resolveForPayment(PaymentMethod.cash, GTB.id)),
      ).rejects.toThrow(/did not go into a bank account/);
    });

    it('leaves cash with no account', async () => {
      await expect(
        asOrg(() => service.resolveForPayment(PaymentMethod.cash)),
      ).resolves.toBeNull();
    });

    it('leaves a cheque optional, since it is banked whenever', async () => {
      await expect(
        asOrg(() => service.resolveForPayment(PaymentMethod.cheque)),
      ).resolves.toBeNull();
    });

    it('never picks an account for the caller', async () => {
      // Defaulting would put money in an account it may never have reached,
      // and the mistake only surfaces when the statement does not match.
      await expect(
        asOrg(() => service.resolveForPayment(PaymentMethod.transfer)),
      ).rejects.toThrow(/has to say which account/);
      expect(prisma.bankAccount.findFirst).not.toHaveBeenCalled();
    });

    it('accepts an account that is named and active', async () => {
      await expect(
        asOrg(() => service.resolveForPayment(PaymentMethod.transfer, GTB.id)),
      ).resolves.toBe(GTB.id);
    });

    it('refuses a closed account for new money', async () => {
      prisma.bankAccount.findFirst.mockResolvedValue({
        ...GTB,
        isActive: false,
      });

      await expect(
        asOrg(() => service.resolveForPayment(PaymentMethod.transfer, GTB.id)),
      ).rejects.toThrow(/inactive/);
    });
  });

  describe('setting them up', () => {
    it('stores the account number digits-only', async () => {
      // People paste "0123 4567 89" straight off a banking app.
      await asOrg(() =>
        service.create({
          bankName: 'Guaranty Trust Bank',
          accountName: 'Adebayo Stores',
          accountNumber: '0123 4567-89',
        }),
      );

      expect(prisma.bankAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountNumber: '0123456789',
          }) as object,
        }),
      );
    });

    it('clears the previous default when a new one is set', async () => {
      prisma.bankAccount.create.mockResolvedValue({ ...GTB, isDefault: true });

      await asOrg(() =>
        service.create({
          bankName: 'Zenith Bank',
          accountName: 'Adebayo Stores',
          accountNumber: '1010101010',
          isDefault: true,
        }),
      );

      expect(prisma.bankAccount.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isDefault: false } }),
      );
    });

    it('hides closed accounts from the picker by default', async () => {
      await asOrg(() => Promise.resolve(service.findAll()));

      expect(prisma.bankAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }) as object,
        }),
      );
    });

    it('refuses to delete one that money was banked into', async () => {
      // Otherwise those payments can no longer say where the money went, which
      // is the one question this model exists to answer.
      prisma.payment.count.mockResolvedValue(14);

      await expect(asOrg(() => service.remove(GTB.id))).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.bankAccount.update).not.toHaveBeenCalled();
    });

    it('soft-deletes an account nothing points at', async () => {
      await asOrg(() => service.remove(GTB.id));

      expect(prisma.bankAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false }) as object,
        }),
      );
    });
  });
});
