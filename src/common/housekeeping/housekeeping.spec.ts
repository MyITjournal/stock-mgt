import { HousekeepingService } from './housekeeping.service';
import type { PrismaService } from '../../prisma/prisma.service';

const NOW = new Date('2026-10-05T10:00:00Z');

function build(deadFamilies: string[][] = [[]]) {
  const prisma = {
    idempotencyKey: {
      deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    refreshToken: {
      // One page of dead chains per call, then none.
      groupBy: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
  for (const page of deadFamilies) {
    prisma.refreshToken.groupBy.mockResolvedValueOnce(
      page.map((familyId) => ({ familyId })),
    );
  }
  prisma.refreshToken.groupBy.mockResolvedValue([]);
  const service = new HousekeepingService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('housekeeping', () => {
  it('clears stored write replies past their window', async () => {
    const { service, prisma } = build();
    await service.sweep(NOW);
    expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: NOW } },
    });
  });

  it('removes a sign-in chain only once its newest token has expired', async () => {
    const { service, prisma } = build([['family-a', 'family-b']]);
    await service.sweep(NOW);

    // The chain is chosen by its *newest* token, so a replaced token whose
    // chain is still alive — the one that catches a stolen session — stays.
    expect(prisma.refreshToken.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['familyId'],
        having: { expiresAt: { _max: { lt: NOW } } },
      }),
    );
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { familyId: { in: ['family-a', 'family-b'] } },
    });
  });

  it('deletes nothing from sessions when no chain has fully expired', async () => {
    const { service, prisma } = build([[]]);
    await service.sweep(NOW);
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it('works through a backlog a batch at a time', async () => {
    const full = Array.from({ length: 500 }, (_, i) => `family-${i}`);
    const { service, prisma } = build([full, ['family-last']]);
    await service.sweep(NOW);
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('never throws, so a failed sweep cannot take the server down', async () => {
    const { service, prisma } = build();
    prisma.idempotencyKey.deleteMany.mockRejectedValue(new Error('db away'));
    await expect(service.sweep(NOW)).resolves.toBeUndefined();
  });

  it('does not run two sweeps at once', async () => {
    const { service, prisma } = build();
    let release!: () => void;
    prisma.idempotencyKey.deleteMany.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ count: 0 });
      }),
    );
    const first = service.sweep(NOW);
    await service.sweep(NOW);
    release();
    await first;
    expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledTimes(1);
  });
});
