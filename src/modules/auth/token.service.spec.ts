import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { TokenService } from './token.service';
import { PrismaService } from '../../prisma/prisma.service';

const PAYLOAD = {
  sub: 'user-1',
  email: 'a@orga.test',
  organizationId: 'org-a',
  orgRole: OrgRole.owner,
};

describe('TokenService', () => {
  let service: TokenService;

  const prisma = {
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    membership: { findFirst: jest.fn() },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };

  /** Typed view of what was written to refreshToken.create, per call. */
  type CreatedToken = { data: { familyId: string; tokenHash: string } };
  const createdTokens = (): CreatedToken[] =>
    prisma.refreshToken.create.mock.calls.map(
      (call) => (call as unknown as [CreatedToken])[0],
    );

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();

    service = module.get(TokenService);
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
  });

  afterEach(() => jest.resetAllMocks());

  describe('issuePair', () => {
    it('returns a refresh token as selector.verifier', async () => {
      const pair = await service.issuePair(PAYLOAD);
      const [selector, verifier] = pair.refreshToken.split('.');

      expect(selector).toHaveLength(32);
      expect(verifier).toHaveLength(64);
    });

    it('stores only a hash of the verifier, never the raw token', async () => {
      const pair = await service.issuePair(PAYLOAD);
      const [, verifier] = pair.refreshToken.split('.');
      const stored = createdTokens()[0].data;

      expect(stored.tokenHash).not.toContain(verifier);
      await expect(argon2.verify(stored.tokenHash, verifier)).resolves.toBe(
        true,
      );
    });

    it('starts a new family per login but reuses one on rotation', async () => {
      await service.issuePair(PAYLOAD);
      await service.issuePair(PAYLOAD);
      const [first, second] = createdTokens();
      expect(first.data.familyId).not.toBe(second.data.familyId);

      await service.issuePair(PAYLOAD, {}, 'family-fixed');
      expect(createdTokens()[2].data.familyId).toBe('family-fixed');
    });
  });

  describe('rotate', () => {
    async function storedToken(overrides: Record<string, unknown> = {}) {
      const verifier = 'v'.repeat(64);
      return {
        verifier,
        row: {
          id: 'rt-1',
          userId: 'user-1',
          organizationId: 'org-a',
          tokenHash: await argon2.hash(verifier),
          familyId: 'fam-1',
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
          replacedById: null,
          ...overrides,
        },
      };
    }

    it('rejects a malformed token', async () => {
      await expect(service.rotate('no-dot')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an unknown selector', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.rotate('sel.ver')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a wrong verifier', async () => {
      const { row } = await storedToken();
      prisma.refreshToken.findUnique.mockResolvedValue(row);

      await expect(service.rotate('sel.wrongverifier')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired token', async () => {
      const { verifier, row } = await storedToken({
        expiresAt: new Date(Date.now() - 1000),
      });
      prisma.refreshToken.findUnique.mockResolvedValue(row);

      await expect(service.rotate(`sel.${verifier}`)).rejects.toThrow(
        'Refresh token has expired',
      );
    });

    it('revokes the whole family when an already-rotated token is replayed', async () => {
      const { verifier, row } = await storedToken({ replacedById: 'rt-2' });
      prisma.refreshToken.findUnique.mockResolvedValue(row);

      await expect(service.rotate(`sel.${verifier}`)).rejects.toThrow(
        'Refresh token has already been used',
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });

    it('refuses to rotate once the membership is inactive', async () => {
      const { verifier, row } = await storedToken();
      prisma.refreshToken.findUnique.mockResolvedValue(row);
      prisma.membership.findFirst.mockResolvedValue(null);

      await expect(service.rotate(`sel.${verifier}`)).rejects.toThrow(
        'Membership is no longer active',
      );
    });

    it('issues a new pair in the same family and revokes the old row', async () => {
      const { verifier, row } = await storedToken();
      prisma.refreshToken.findUnique.mockResolvedValue(row);
      prisma.membership.findFirst.mockResolvedValue({
        userId: 'user-1',
        organizationId: 'org-a',
        role: OrgRole.owner,
        user: { email: 'a@orga.test' },
      });
      prisma.refreshToken.findFirst.mockResolvedValue({ id: 'rt-2' });

      const pair = await service.rotate(`sel.${verifier}`);

      expect(pair.refreshToken).not.toBe(`sel.${verifier}`);
      expect(createdTokens()[0].data.familyId).toBe('fam-1');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) as Date, replacedById: 'rt-2' },
      });
    });
  });
});
