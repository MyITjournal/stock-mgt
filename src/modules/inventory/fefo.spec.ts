import { allocateFefo, sortFefo, AllocatableBatch } from './fefo';

const at = (iso: string) => new Date(iso);

function batch(
  batchId: string,
  quantity: number,
  expiry: string | null,
  received = '2026-01-01',
): AllocatableBatch {
  return {
    batchId,
    quantity,
    expiryDate: expiry ? at(expiry) : null,
    receivedAt: at(received),
  };
}

describe('sortFefo', () => {
  it('picks the earliest expiry, even when it arrived last', () => {
    const older = batch('received-first', 10, '2026-12-01', '2026-01-01');
    const shorterDated = batch(
      'received-second',
      10,
      '2026-06-01',
      '2026-05-01',
    );

    expect(sortFefo([older, shorterDated]).map((b) => b.batchId)).toEqual([
      'received-second',
      'received-first',
    ]);
  });

  it('sorts undated batches last — nothing urgent about them', () => {
    const undated = batch('no-expiry', 10, null);
    const dated = batch('expires', 10, '2027-01-01');

    expect(sortFefo([undated, dated]).map((b) => b.batchId)).toEqual([
      'expires',
      'no-expiry',
    ]);
  });

  it('breaks an expiry tie on receipt date', () => {
    const later = batch('later', 10, '2026-06-01', '2026-03-01');
    const earlier = batch('earlier', 10, '2026-06-01', '2026-02-01');

    expect(sortFefo([later, earlier]).map((b) => b.batchId)).toEqual([
      'earlier',
      'later',
    ]);
  });

  it('is stable when expiry and receipt both tie, so pages do not shuffle', () => {
    const b = batch('bbb', 10, '2026-06-01');
    const a = batch('aaa', 10, '2026-06-01');

    expect(sortFefo([b, a]).map((x) => x.batchId)).toEqual(['aaa', 'bbb']);
  });

  it('does not mutate the input', () => {
    const input = [batch('b', 1, '2026-12-01'), batch('a', 1, '2026-01-01')];
    sortFefo(input);
    expect(input.map((x) => x.batchId)).toEqual(['b', 'a']);
  });
});

describe('allocateFefo', () => {
  it('takes everything from one batch when it covers the pick', () => {
    const result = allocateFefo([batch('only', 50, '2026-06-01')], 20);

    expect(result).toEqual({
      allocations: [{ batchId: 'only', quantity: 20 }],
      shortfall: 0,
    });
  });

  it('spills into the next batch, in expiry order', () => {
    const result = allocateFefo(
      [batch('late', 100, '2026-12-01'), batch('soon', 30, '2026-06-01')],
      50,
    );

    expect(result.allocations).toEqual([
      { batchId: 'soon', quantity: 30 },
      { batchId: 'late', quantity: 20 },
    ]);
    expect(result.shortfall).toBe(0);
  });

  it('exhausts a batch exactly without touching the next one', () => {
    const result = allocateFefo(
      [batch('soon', 30, '2026-06-01'), batch('late', 100, '2026-12-01')],
      30,
    );

    expect(result.allocations).toEqual([{ batchId: 'soon', quantity: 30 }]);
    expect(result.shortfall).toBe(0);
  });

  it('reports the shortfall rather than throwing — policy lives one layer up', () => {
    const result = allocateFefo([batch('thin', 5, '2026-06-01')], 8);

    expect(result.allocations).toEqual([{ batchId: 'thin', quantity: 5 }]);
    expect(result.shortfall).toBe(3);
  });

  it('reports the whole pick as shortfall when there is no stock at all', () => {
    expect(allocateFefo([], 12)).toEqual({ allocations: [], shortfall: 12 });
  });

  it('skips empty and already-negative batches instead of burying the shortfall', () => {
    const result = allocateFefo(
      [
        batch('empty', 0, '2026-01-01'),
        batch('forced-negative', -4, '2026-02-01'),
        batch('real', 10, '2026-06-01'),
      ],
      6,
    );

    expect(result.allocations).toEqual([{ batchId: 'real', quantity: 6 }]);
    expect(result.shortfall).toBe(0);
  });

  it('rejects a non-positive or fractional quantity', () => {
    expect(() => allocateFefo([], 0)).toThrow(RangeError);
    expect(() => allocateFefo([], -1)).toThrow(RangeError);
    expect(() => allocateFefo([], 1.5)).toThrow(RangeError);
  });
});
