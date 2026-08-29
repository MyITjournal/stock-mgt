import { hashBody } from './idempotency.interceptor';

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
    expect(hashBody({ units: [{ name: 'piece', factor: 1 }] })).toBe(
      hashBody({ units: [{ factor: 1, name: 'piece' }] }),
    );
  });

  it('differs when a value changes', () => {
    expect(hashBody({ quantity: 1 })).not.toBe(hashBody({ quantity: 2 }));
  });

  it('respects array order, which is meaningful', () => {
    expect(hashBody([1, 2])).not.toBe(hashBody([2, 1]));
  });

  it('distinguishes a missing field from an explicit null', () => {
    expect(hashBody({ a: 1 })).not.toBe(hashBody({ a: 1, b: null }));
  });

  it('handles an empty body', () => {
    expect(typeof hashBody({})).toBe('string');
    expect(hashBody({})).toHaveLength(64);
  });
});
