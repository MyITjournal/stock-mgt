import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { SyncService } from './sync.service';

const ORG = 'org-aaa';

function movement(id: string, createdAt: string) {
  return { id, createdAt: new Date(createdAt) };
}

describe('SyncService', () => {
  let service: SyncService;
  let prisma: { stockMovement: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { stockMovement: { findMany: jest.fn().mockResolvedValue([]) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SyncService, { provide: TENANT_PRISMA, useValue: prisma }],
    }).compile();

    service = module.get(SyncService);
  });

  const sync = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: ORG }, fn);

  /** The `where` clause of the most recent query, for inspection. */
  function lastWhere() {
    const calls = prisma.stockMovement.findMany.mock.calls as [
      { where: { AND: Record<string, unknown>[] } },
    ][];
    return calls.at(-1)![0].where;
  }

  it('holds the window a second short of now', async () => {
    const before = Date.now();
    const result = await sync(() => service.movements({}));
    const after = Date.now();

    // A row committed at .400 can appear after one committed at .600. Reading
    // right up to the server clock steps over the straggler, and the cursor
    // never goes back for it.
    expect(result.syncedThrough.getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect(result.syncedThrough.getTime()).toBeLessThanOrEqual(after - 1000);
    expect(lastWhere().AND[0]).toEqual({
      createdAt: { lte: result.syncedThrough },
    });
  });

  it('pages on (createdAt, id), not on createdAt alone', async () => {
    // Two movements sharing a timestamp must not hide each other: the id
    // breaks the tie in the cursor as well as in the sort.
    const rows = [
      movement('aaa', '2026-08-29T10:00:00.000Z'),
      movement('bbb', '2026-08-29T10:00:00.000Z'),
    ];
    prisma.stockMovement.findMany.mockResolvedValue(rows);

    const first = await sync(() => service.movements({ limit: 2 }));
    expect(first.nextCursor).not.toBeNull();

    await sync(() =>
      service.movements({ limit: 2, cursor: first.nextCursor as string }),
    );

    expect(lastWhere().AND[1]).toEqual({
      OR: [
        { createdAt: { gt: new Date('2026-08-29T10:00:00.000Z') } },
        { createdAt: new Date('2026-08-29T10:00:00.000Z'), id: { gt: 'bbb' } },
      ],
    });
  });

  it('orders by the same key it pages on', async () => {
    await sync(() => service.movements({}));

    const [[args]] = prisma.stockMovement.findMany.mock.calls as [
      [{ orderBy: unknown }],
    ];
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('stops handing out cursors once the client is caught up', async () => {
    prisma.stockMovement.findMany.mockResolvedValue([
      movement('aaa', '2026-08-29T10:00:00.000Z'),
    ]);

    const result = await sync(() => service.movements({ limit: 10 }));

    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  it('falls back to `since` only when no cursor is given', async () => {
    const since = new Date('2026-08-01T00:00:00.000Z');
    await sync(() => service.movements({ since }));

    expect(lastWhere().AND[1]).toEqual({ createdAt: { gt: since } });
  });

  it('ignores `since` when a cursor is given, so a page cannot be skipped', async () => {
    prisma.stockMovement.findMany.mockResolvedValue([
      movement('aaa', '2026-08-29T10:00:00.000Z'),
    ]);
    const { nextCursor } = await sync(() => service.movements({ limit: 1 }));

    await sync(() =>
      service.movements({
        limit: 1,
        cursor: nextCursor as string,
        since: new Date('2027-01-01T00:00:00.000Z'),
      }),
    );

    expect(JSON.stringify(lastWhere())).not.toContain('2027');
  });

  it('caps the page size a caller can ask for', async () => {
    await sync(() => service.movements({ limit: 99999 }));

    const [[args]] = prisma.stockMovement.findMany.mock.calls as [
      [{ take: number }],
    ];
    expect(args.take).toBe(1000);
  });

  it('rejects a malformed cursor rather than silently starting over', async () => {
    await expect(
      sync(() => service.movements({ cursor: 'not-a-cursor' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
