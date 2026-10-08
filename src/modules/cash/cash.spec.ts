import { notBanked, oldestUnbanked, stillHolding } from './cash';

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 9));

describe('stillHolding', () => {
  it('is what came in less everything that left their hands', () => {
    expect(
      stillHolding({
        received: 100_000_00,
        paidOut: 5_000_00,
        banked: 60_000_00,
        waiting: 20_000_00,
      }),
    ).toBe(15_000_00);
  });

  it('keeps a shortfall as still holding — nothing is written off', () => {
    // Took ₦50,000, banked ₦48,000: the ₦2,000 stays against them.
    expect(
      stillHolding({
        received: 50_000_00,
        paidOut: 0,
        banked: 48_000_00,
        waiting: 0,
      }),
    ).toBe(2_000_00);
  });

  it('counts waiting banking as out of their hands', () => {
    expect(
      stillHolding({
        received: 10_000_00,
        paidOut: 0,
        banked: 0,
        waiting: 10_000_00,
      }),
    ).toBe(0);
  });
});

describe('oldestUnbanked', () => {
  // Newest first, as the service reads them.
  const receipts = [
    { amount: 3_000_00, occurredAt: day(5) },
    { amount: 2_000_00, occurredAt: day(4) },
    { amount: 4_000_00, occurredAt: day(3) },
  ];

  it('is null when nothing is held', () => {
    expect(oldestUnbanked(0, receipts)).toBeNull();
    expect(oldestUnbanked(-500_00, receipts)).toBeNull();
  });

  it('treats what left their hands as the oldest money', () => {
    // ₦9,000 taken, ₦4,000 banked: the newest ₦5,000 is still held, and the
    // oldest of that is the 4th.
    expect(oldestUnbanked(5_000_00, receipts)).toEqual(day(4));
  });

  it('lands inside a receipt that is partly banked', () => {
    expect(oldestUnbanked(5_500_00, receipts)).toEqual(day(3));
  });

  it('is the newest receipt when only today’s takings are held', () => {
    expect(oldestUnbanked(1_00, receipts)).toEqual(day(5));
  });

  it('falls back to the oldest receipt read if they run out', () => {
    expect(oldestUnbanked(50_000_00, receipts)).toEqual(day(3));
    expect(oldestUnbanked(1_00, [])).toBeNull();
  });
});

describe('notBanked', () => {
  it('adds up what people hold', () => {
    expect(notBanked([5_000_00, 2_000_00])).toBe(7_000_00);
  });

  it('does NOT let one person paying out more cancel a colleague holding', () => {
    expect(notBanked([5_000_00, -3_000_00])).toBe(5_000_00);
  });
});
