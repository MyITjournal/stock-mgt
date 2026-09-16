import { ConflictException, ExecutionContext } from '@nestjs/common';
import { Observable, from, lastValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor, hashBody } from './idempotency.interceptor';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../tenancy/tenant-context';

describe('hashBody', () => {
  it('is stable for the same content', () => {
    expect(hashBody({ a: 1, b: 'x' })).toBe(hashBody({ a: 1, b: 'x' }));
  });

  it('ignores key order', () => {
    // A client that serialises its JSON differently between the first attempt
    // and the retry must still be recognised as the same request.
    expect(hashBody({ a: 1, b: 2 })).toBe(hashBody({ b: 2, a: 1 }));
  });

  it('ignores key order in nested objects and inside arrays', () => {
    expect(hashBody({ a: [{ x: 1, y: 2 }] })).toBe(
      hashBody({ a: [{ y: 2, x: 1 }] }),
    );
  });

  it('differs when a value changes', () => {
    expect(hashBody({ a: 1 })).not.toBe(hashBody({ a: 2 }));
  });

  it('respects array order, which is meaningful', () => {
    expect(hashBody({ a: [1, 2] })).not.toBe(hashBody({ a: [2, 1] }));
  });

  it('distinguishes a missing field from an explicit null', () => {
    expect(hashBody({ a: 1 })).not.toBe(hashBody({ a: 1, b: null }));
  });

  it('handles an empty body', () => {
    expect(hashBody({})).toBe(hashBody({}));
  });

  it('handles no body at all', () => {
    // A command route carries no body, so nothing sets a JSON content type and
    // Express leaves req.body undefined. JSON.stringify(undefined) is not a
    // string, so this used to throw and every keyed POST to
    // /stocktakes/:id/post answered 500.
    expect(() => hashBody(undefined)).not.toThrow();
    expect(hashBody(undefined)).toBe(hashBody(undefined));
    expect(hashBody(undefined)).toBe(hashBody(null));
    expect(hashBody(undefined)).not.toBe(hashBody({}));
  });
});

interface Row {
  id: string;
  organizationId: string;
  key: string;
  endpoint: string;
  requestHash: string;
  statusCode: number | null;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * An in-memory stand-in for the one table this interceptor touches.
 *
 * It enforces the unique constraint on (organizationId, key) **synchronously**,
 * before yielding, which is the behaviour that matters: Postgres decides the
 * winner at insert time, so a fake that checked after an await would let both
 * racers through and quietly prove nothing.
 */
class FakeKeyTable {
  rows: Row[] = [];
  private nextId = 1;

  create({
    data,
  }: {
    data: Omit<Row, 'id' | 'statusCode' | 'responseBody' | 'createdAt'>;
  }) {
    const clash = this.rows.some(
      (row) =>
        row.organizationId === data.organizationId && row.key === data.key,
    );
    // Shaped like Prisma's own: an Error carrying the P2002 code, which is
    // what the interceptor matches on.
    if (clash) {
      return Promise.reject(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );
    }

    const row: Row = {
      ...data,
      id: `row-${this.nextId++}`,
      statusCode: null,
      responseBody: null,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findFirst({
    where,
  }: {
    where: { organizationId: string; key: string };
  }): Promise<Row | null> {
    return Promise.resolve(
      this.rows.find(
        (row) =>
          row.organizationId === where.organizationId && row.key === where.key,
      ) ?? null,
    );
  }

  update({
    where,
    data,
  }: {
    where: { id: string };
    data: Partial<Row>;
  }): Promise<Row> {
    const row = this.rows.find((candidate) => candidate.id === where.id);
    if (!row) return Promise.reject(new Error('not found'));
    Object.assign(row, data);
    return Promise.resolve(row);
  }

  updateMany({
    where,
    data,
  }: {
    where: { id: string; statusCode: null; createdAt: Date };
    data: Partial<Row>;
  }): Promise<{ count: number }> {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === where.id &&
        candidate.statusCode === null &&
        candidate.createdAt.getTime() === where.createdAt.getTime(),
    );
    if (!row) return Promise.resolve({ count: 0 });
    Object.assign(row, data);
    return Promise.resolve({ count: 1 });
  }

  delete({ where }: { where: { id: string } }): Promise<Row> {
    const index = this.rows.findIndex((row) => row.id === where.id);
    if (index === -1) return Promise.reject(new Error('not found'));
    return Promise.resolve(this.rows.splice(index, 1)[0]);
  }
}

const ORG = 'org-1';

function contextFor(options: {
  key?: string;
  method?: string;
  url: string;
  body?: unknown;
  status?: number;
}) {
  const response = {
    statusCode: options.status ?? 201,
    status: jest.fn(),
    setHeader: jest.fn(),
  };

  const request = {
    method: options.method ?? 'POST',
    originalUrl: options.url,
    body: options.body ?? {},
    header: (name: string) =>
      name.toLowerCase() === 'idempotency-key' ? options.key : undefined,
  };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { context, response };
}

describe('IdempotencyInterceptor', () => {
  let table: FakeKeyTable;
  let interceptor: IdempotencyInterceptor;

  beforeEach(() => {
    table = new FakeKeyTable();
    interceptor = new IdempotencyInterceptor({
      idempotencyKey: table,
    } as unknown as PrismaService);
  });

  /** Runs one request through the interceptor inside a tenant scope. */
  function run(
    options: Parameters<typeof contextFor>[0],
    handler: () => Observable<unknown>,
  ) {
    const { context, response } = contextFor(options);
    return {
      response,
      result: TenantContext.run({ organizationId: ORG }, async () => {
        const stream = await interceptor.intercept(context, {
          handle: handler,
        });
        return lastValueFrom(stream);
      }),
    };
  }

  it('does not touch the table when no key is sent', async () => {
    const handler = jest.fn(() => of({ id: 'sale-1' }));

    const { result } = run({ url: '/api/v1/sales' }, handler);

    await expect(result).resolves.toEqual({ id: 'sale-1' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(table.rows).toHaveLength(0);
  });

  it('replays the first answer for an identical retry', async () => {
    const handler = jest.fn(() => of({ id: 'sale-1', invoiceNumber: 7 }));
    const request = { url: '/api/v1/sales', key: 'k1', body: { total: 500 } };

    await run(request, handler).result;
    const retry = run(request, handler);

    await expect(retry.result).resolves.toEqual({
      id: 'sale-1',
      invoiceNumber: 7,
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(retry.response.setHeader).toHaveBeenCalledWith(
      'Idempotent-Replay',
      'true',
    );
    expect(retry.response.status).toHaveBeenCalledWith(201);
  });

  it('refuses the same key aimed at a different resource', async () => {
    // The regression this file exists for. Posting two different stocktakes
    // with one key used to match on the route *pattern* — and since the route
    // has no body, the hashes matched too, so the second call replayed the
    // first answer and posted nothing at all.
    const handler = jest.fn(() => of({ posted: true }));

    await run({ url: '/api/v1/stocktakes/aaa/post', key: 'k1' }, handler)
      .result;
    const second = run(
      { url: '/api/v1/stocktakes/bbb/post', key: 'k1' },
      handler,
    );

    await expect(second.result).rejects.toBeInstanceOf(ConflictException);
    await expect(second.result).rejects.toThrow('a different request');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(second.response.setHeader).not.toHaveBeenCalled();
  });

  it('refuses the same key with a different body', async () => {
    const handler = jest.fn(() => of({ ok: true }));

    await run(
      { url: '/api/v1/sales', key: 'k1', body: { total: 500 } },
      handler,
    ).result;
    const second = run(
      { url: '/api/v1/sales', key: 'k1', body: { total: 900 } },
      handler,
    );

    await expect(second.result).rejects.toBeInstanceOf(ConflictException);
    await expect(second.result).rejects.toThrow('a different request');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('releases the key when the work fails, so a retry really retries', async () => {
    // A 409 for insufficient stock is exactly the case where retrying after
    // fixing the problem is the right thing to do.
    const failing = jest.fn(() => throwError(() => new Error('no stock')));
    const request = { url: '/api/v1/sales', key: 'k1', body: { total: 500 } };

    await expect(run(request, failing).result).rejects.toThrow('no stock');
    expect(table.rows).toHaveLength(0);

    const succeeding = jest.fn(() => of({ id: 'sale-1' }));
    await expect(run(request, succeeding).result).resolves.toEqual({
      id: 'sale-1',
    });
    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  it('refuses a second request while the first is still running', async () => {
    // The race the reservation exists for: a client times out and retries
    // while the original request is still working.
    let release!: (value: { id: string }) => void;
    const pending = new Promise<{ id: string }>((resolve) => {
      release = resolve;
    });

    const request = { url: '/api/v1/sales', key: 'k1', body: { total: 500 } };
    const slow = jest.fn(() => from(pending));

    const first = run(request, slow);
    // Let the first claim the key before the second one looks.
    await Promise.resolve();

    const second = run(
      request,
      jest.fn(() => of({ id: 'sale-2' })),
    );
    await expect(second.result).rejects.toBeInstanceOf(ConflictException);
    // Specifically the in-flight branch, not the different-request one: both
    // throw a 409, and only the message says which rule fired.
    await expect(second.result).rejects.toThrow('still in progress');

    release({ id: 'sale-1' });
    await expect(first.result).resolves.toEqual({ id: 'sale-1' });
  });

  it('takes over a claim whose request never finished', async () => {
    // A process that died mid-request would otherwise poison that key until
    // the nightly sweep.
    table.rows.push({
      id: 'stale-1',
      organizationId: ORG,
      key: 'k1',
      endpoint: 'POST /api/v1/sales',
      requestHash: hashBody({ total: 500 }),
      statusCode: null,
      responseBody: null,
      createdAt: new Date(Date.now() - 10 * 60_000),
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const handler = jest.fn(() => of({ id: 'sale-1' }));
    const { result } = run(
      { url: '/api/v1/sales', key: 'k1', body: { total: 500 } },
      handler,
    );

    await expect(result).resolves.toEqual({ id: 'sale-1' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].statusCode).toBe(201);
  });
});
