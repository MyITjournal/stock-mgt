import { allocateOldest, planAllocations } from './allocation';
import { saleBalance, withBalance } from './balance';

const INV_A = 'sale-a';
const INV_B = 'sale-b';

/** Two unpaid invoices, the older one first. */
const outstanding = [
  { saleId: INV_A, balance: 10_800_000 },
  { saleId: INV_B, balance: 5_000_000 },
];

describe('planAllocations', () => {
  it('splits one payment across the invoices it settles', () => {
    // The ₦50,000 transfer that covers two bills: one payment row, two claims.
    const plan = planAllocations(
      5_000_000,
      [
        { saleId: INV_A, amount: 3_000_000 },
        { saleId: INV_B, amount: 2_000_000 },
      ],
      outstanding,
    );

    expect(plan.allocations).toHaveLength(2);
    expect(plan.unallocated).toBe(0);
  });

  it('leaves the remainder as credit rather than forcing it somewhere', () => {
    const plan = planAllocations(
      5_000_000,
      [{ saleId: INV_B, amount: 3_000_000 }],
      outstanding,
    );

    expect(plan.unallocated).toBe(2_000_000);
  });

  it('refuses to allocate more than an invoice still owes', () => {
    expect(() =>
      planAllocations(
        9_000_000,
        [{ saleId: INV_B, amount: 6_000_000 }],
        outstanding,
      ),
    ).toThrow(/5000000 is outstanding/);
  });

  it('refuses to allocate more than the payment itself', () => {
    expect(() =>
      planAllocations(
        1_000_000,
        [{ saleId: INV_A, amount: 3_000_000 }],
        outstanding,
      ),
    ).toThrow(/more than the payment/);
  });

  it('refuses an invoice that is not on this account', () => {
    expect(() =>
      planAllocations(
        1_000_000,
        [{ saleId: 'someone-elses-sale', amount: 1_000_000 }],
        outstanding,
      ),
    ).toThrow(/not on this payment's account/);
  });

  it('refuses the same invoice twice in one payment', () => {
    expect(() =>
      planAllocations(
        2_000_000,
        [
          { saleId: INV_A, amount: 1_000_000 },
          { saleId: INV_A, amount: 1_000_000 },
        ],
        outstanding,
      ),
    ).toThrow(/allocated to twice/);
  });

  it('refuses an allocation that runs against the payment', () => {
    // Money in cannot deepen a debt, and money out cannot settle one.
    expect(() =>
      planAllocations(
        1_000_000,
        [{ saleId: INV_A, amount: -1_000_000 }],
        outstanding,
      ),
    ).toThrow(/opposite way/);
  });

  it('lets a refund unwind an invoice the business now owes on', () => {
    const plan = planAllocations(
      -6_000_000,
      [{ saleId: INV_A, amount: -6_000_000 }],
      [{ saleId: INV_A, balance: -6_000_000 }],
    );

    expect(plan.unallocated).toBe(0);
  });

  it('refuses a payment of nothing', () => {
    expect(() => planAllocations(0, [], outstanding)).toThrow(
      /records nothing/,
    );
  });

  it('refuses fractional kobo', () => {
    expect(() => planAllocations(100.5, [], outstanding)).toThrow(
      /whole number of kobo/,
    );
  });
});

describe('allocateOldest', () => {
  it('fills the oldest invoice first, then spills into the next', () => {
    expect(allocateOldest(12_000_000, outstanding)).toEqual([
      { saleId: INV_A, amount: 10_800_000 },
      { saleId: INV_B, amount: 1_200_000 },
    ]);
  });

  it('stops when the money runs out', () => {
    expect(allocateOldest(1_000_000, outstanding)).toEqual([
      { saleId: INV_A, amount: 1_000_000 },
    ]);
  });

  it('leaves everything unallocated when nothing is owed', () => {
    expect(allocateOldest(1_000_000, [])).toEqual([]);
  });

  it('skips invoices running the other way', () => {
    expect(
      allocateOldest(1_000_000, [
        { saleId: INV_A, balance: -5_000 },
        { saleId: INV_B, balance: 5_000_000 },
      ]),
    ).toEqual([{ saleId: INV_B, amount: 1_000_000 }]);
  });
});

describe('saleBalance', () => {
  const sale = { total: 12_000_000, allocations: [], returns: [] };

  it('owes the whole total when nothing has been paid', () => {
    expect(saleBalance(sale).balance).toBe(12_000_000);
  });

  it('lands on zero when paid in full', () => {
    expect(
      saleBalance({ ...sale, allocations: [{ amount: 12_000_000 }] }).balance,
    ).toBe(0);
  });

  /**
   * The composition that matters: pay, then return half, then hand the cash
   * back. Each step is an ordinary row and the arithmetic never branches.
   */
  it('composes through payment, return and refund', () => {
    const paid = { ...sale, allocations: [{ amount: 12_000_000 }] };
    expect(saleBalance(paid).balance).toBe(0);

    const halfReturned = { ...paid, returns: [{ refundAmount: 6_000_000 }] };
    // Negative: the shop owes the customer now.
    expect(saleBalance(halfReturned).balance).toBe(-6_000_000);

    const cashHandedBack = {
      ...halfReturned,
      allocations: [{ amount: 12_000_000 }, { amount: -6_000_000 }],
    };
    expect(saleBalance(cashHandedBack).balance).toBe(0);
  });

  it('reports what was allocated and refunded alongside the balance', () => {
    const row = withBalance({
      total: 12_000_000,
      allocations: [{ amount: 5_000_000 }],
      returns: [{ refundAmount: 1_000_000 }],
    });

    expect(row).toMatchObject({
      allocated: 5_000_000,
      refunded: 1_000_000,
      balance: 6_000_000,
    });
  });
});
