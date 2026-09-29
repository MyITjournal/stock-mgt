import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MembershipStatus, OrgRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { TokenService } from '../auth/token.service';
import { StaffService } from './staff.service';

jest.mock('argon2', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));

const ORG = 'org-aaa';
const OWNER = 'user-owner';

describe('StaffService', () => {
  let service: StaffService;
  let prisma: {
    organization: { findFirst: jest.Mock; findFirstOrThrow: jest.Mock };
    membership: {
      count: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    user: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let tokens: { revokeAllForUser: jest.Mock };

  beforeEach(async () => {
    prisma = {
      organization: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ slug: 'adebayo-stores', maxUsers: 5 }),
        findFirstOrThrow: jest.fn().mockResolvedValue({ maxUsers: 5 }),
      },
      membership: {
        // One active member so far: the owner.
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue({
          id: 'mem-1',
          role: OrgRole.sales_rep,
          status: MembershipStatus.active,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'mem-new' }),
        update: jest.fn().mockResolvedValue({ id: 'mem-1' }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'user-new' }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    tokens = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokens },
      ],
    }).compile();

    service = module.get(StaffService);
  });

  const asOwner = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: ORG, userId: OWNER }, fn);

  const cashier = {
    firstName: 'Amina',
    username: 'amina',
    password: 'first-password',
    role: OrgRole.sales_rep,
  };

  describe('adding staff', () => {
    it('qualifies the username with the shop, so two shops can each have an Amina', async () => {
      await asOwner(() => service.create(cashier));

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            username: 'amina@adebayo-stores',
          }) as object,
        }),
      );
    });

    it('creates the account already verified', async () => {
      // A cashier has no mailbox, so an OTP would never arrive and they could
      // never sign in. The owner standing next to them is the verification.
      await asOwner(() => service.create(cashier));

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isVerified: true }) as object,
        }),
      );
    });

    it('refuses somebody with neither a username nor an email', async () => {
      await expect(
        asOwner(() =>
          service.create({ ...cashier, username: undefined } as never),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a sixth active person on a five-seat plan', async () => {
      prisma.membership.count.mockResolvedValue(5);

      await expect(asOwner(() => service.create(cashier))).rejects.toThrow(
        /covers 5 active people/,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('does not attach an existing account to a second business', async () => {
      prisma.user.findFirst.mockResolvedValue({
        email: null,
        username: 'amina@adebayo-stores',
      });

      await expect(
        asOwner(() => service.create(cashier)),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('the seat cap counts active people only', () => {
    it('lets a suspended member free a seat for somebody new', async () => {
      // Five memberships exist but only four are active, so there is room.
      prisma.membership.count.mockResolvedValue(4);

      await expect(
        asOwner(() => service.create(cashier)),
      ).resolves.toBeDefined();
    });

    it('checks for room again before restoring somebody', async () => {
      prisma.membership.findFirst.mockResolvedValue({
        id: 'mem-1',
        role: OrgRole.sales_rep,
        status: MembershipStatus.suspended,
      });
      prisma.membership.count.mockResolvedValue(5);

      await expect(
        asOwner(() =>
          service.update('user-x', { status: MembershipStatus.active }, OWNER),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('guards that keep a business reachable', () => {
    it('refuses to demote the only owner', async () => {
      prisma.membership.findFirst.mockResolvedValue({
        id: 'mem-1',
        role: OrgRole.owner,
        status: MembershipStatus.active,
      });
      // Nobody else is an owner.
      prisma.membership.count.mockResolvedValue(0);

      await expect(
        asOwner(() =>
          service.update('user-other', { role: OrgRole.manager }, OWNER),
        ),
      ).rejects.toThrow(/only owner/);
    });

    it('allows demoting an owner once there is a second one', async () => {
      prisma.membership.findFirst.mockResolvedValue({
        id: 'mem-1',
        role: OrgRole.owner,
        status: MembershipStatus.active,
      });
      prisma.membership.count.mockResolvedValue(1);

      await expect(
        asOwner(() =>
          service.update('user-other', { role: OrgRole.manager }, OWNER),
        ),
      ).resolves.toBeDefined();
    });

    it('refuses to let somebody change their own role', async () => {
      prisma.membership.findFirst.mockResolvedValue({
        id: 'mem-1',
        role: OrgRole.owner,
        status: MembershipStatus.active,
      });

      await expect(
        asOwner(() => service.update(OWNER, { role: OrgRole.manager }, OWNER)),
      ).rejects.toThrow(/your own role/);
    });

    it('refuses to let somebody suspend themselves', async () => {
      await expect(
        asOwner(() =>
          service.update(OWNER, { status: MembershipStatus.suspended }, OWNER),
        ),
      ).rejects.toThrow(/suspend yourself/);
    });
  });

  it('suspends rather than deletes, because their name is on the sales', async () => {
    await asOwner(() => service.suspend('user-x', OWNER));

    expect(prisma.membership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MembershipStatus.suspended,
        }) as object,
      }),
    );
  });

  describe('ending the sessions a change was meant to end', () => {
    it('revokes every token when an owner resets a password', async () => {
      await asOwner(() =>
        service.resetPassword('user-x', { password: 'new-password' }),
      );

      // Without this the new password only stops the *next* sign-in, while the
      // refresh token issued under the old one keeps renewing for a week — and
      // an owner resetting a cashier's password believes they have just locked
      // that person out.
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-x');
    });

    it('revokes every token when somebody is suspended', async () => {
      await asOwner(() => service.suspend('user-x', OWNER));

      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-x');
    });

    it('leaves sessions alone for an edit that is not either of those', async () => {
      await asOwner(() => service.update('user-x', { opensAt: 480 }, OWNER));

      expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
