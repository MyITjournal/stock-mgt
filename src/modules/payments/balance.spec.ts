import { splitOwed } from './balance';

/**
 * The rule these guard is the one a receivables screen broke by having it
 * twice: the headline filtered credits out while the per-customer breakdown
 * netted them away, so the two disagreed by the size of a single returned
 * invoice and nothing said why.
 */
describe('splitOwed', () => {
  it('adds up plain debts', () => {
    expect(splitOwed([300_00, 5_000_00, 1_428_00])).toEqual({
      owed: 300_00 + 5_000_00 + 1_428_00,
      credit: 0,
    });
  });

  it('reports a credit as a positive number, on its own side', () => {
    expect(splitOwed([-21_000_00])).toEqual({ owed: 0, credit: 21_000_00 });
  });

  it('does NOT net a credit against unrelated debts', () => {
    // The bug, in one assertion. Netting gives 9,000 and reports neither the
    // debt nor the money owed back — and on the walk-in bucket it is not even
    // one party's position, it is several strangers' debts with one
    // stranger's credit taken off the pile.
    const split = splitOwed([30_000_00, -21_000_00]);

    expect(split.owed).toBe(30_000_00);
    expect(split.credit).toBe(21_000_00);
    expect(split.owed - split.credit).toBe(9_000_00);
  });

  it('ignores settled invoices, which carry no balance either way', () => {
    expect(splitOwed([0, 500_00, 0])).toEqual({ owed: 500_00, credit: 0 });
  });

  it('is empty for a business nobody owes', () => {
    expect(splitOwed([])).toEqual({ owed: 0, credit: 0 });
  });

  it('sums to the same answer however the balances are ordered', () => {
    const balances = [300_00, -21_000_00, 5_000_00, -450_00, 1_428_00];
    const forwards = splitOwed(balances);
    const backwards = splitOwed([...balances].reverse());

    expect(forwards).toEqual(backwards);
  });

  /**
   * The invariant the screen actually needs: whatever grouping a caller
   * applies, the parts have to add to the whole. Grouping and totalling both
   * go through this function now, so this holds by construction — the test is
   * here because it did not hold when they were two pieces of arithmetic.
   */
  it('splits a set the same way whether grouped or totalled at once', () => {
    const walkIns = [300_00, 990_000_00, 990_000_00, 142_800_00, -21_000_00];
    const named = [5_000_00];

    const whole = splitOwed([...walkIns, ...named]);
    const parts = [splitOwed(walkIns), splitOwed(named)];

    expect(parts.reduce((sum, part) => sum + part.owed, 0)).toBe(whole.owed);
    expect(parts.reduce((sum, part) => sum + part.credit, 0)).toBe(
      whole.credit,
    );
  });
});
