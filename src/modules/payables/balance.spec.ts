import { billBalance, withBillBalance } from './balance';

/**
 * The owner's own worked example, in kobo.
 *
 * A vendor supplies ₦199,800 on 04/09 and is handed ₦71,800 on the spot,
 * leaving ₦128,000. A second supplies ₦32,000 on 02/09 with nothing paid. A
 * third delivery of ₦64,000 on 17/09 is untouched. The total owed should read
 * ₦224,000.
 *
 * Written down as a test because it is the acceptance criterion the feature was
 * asked for against, and because a payables total that is quietly wrong is
 * worse than no payables total at all.
 */
const NAIRA = 100;

describe('what a vendor bill still owes', () => {
  it('is the invoice less what has been paid', () => {
    expect(
      billBalance({
        amountDue: 199_800 * NAIRA,
        payments: [{ amount: 71_800 * NAIRA }],
      }),
    ).toEqual({ paid: 71_800 * NAIRA, balance: 128_000 * NAIRA });
  });

  it('is the whole invoice when nothing has been paid', () => {
    expect(billBalance({ amountDue: 32_000 * NAIRA, payments: [] })).toEqual({
      paid: 0,
      balance: 32_000 * NAIRA,
    });
  });

  it('is zero once the bill is settled, not negative', () => {
    expect(
      billBalance({
        amountDue: 64_000 * NAIRA,
        payments: [{ amount: 40_000 * NAIRA }, { amount: 24_000 * NAIRA }],
      }),
    ).toEqual({ paid: 64_000 * NAIRA, balance: 0 });
  });

  it('adds several part-payments together', () => {
    const { balance } = billBalance({
      amountDue: 199_800 * NAIRA,
      payments: [
        { amount: 71_800 * NAIRA },
        { amount: 28_000 * NAIRA },
        { amount: 50_000 * NAIRA },
      ],
    });

    expect(balance).toBe(50_000 * NAIRA);
  });

  it('comes to the owner’s ₦224,000 across three vendors', () => {
    const bills = [
      // Supplied 04/09, part-paid on the spot.
      { amountDue: 199_800 * NAIRA, payments: [{ amount: 71_800 * NAIRA }] },
      // Supplied 02/09, nothing paid.
      { amountDue: 32_000 * NAIRA, payments: [] },
      // Supplied 17/09, nothing paid.
      { amountDue: 64_000 * NAIRA, payments: [] },
    ];

    const total = bills
      .map(billBalance)
      .reduce((sum, bill) => sum + bill.balance, 0);

    expect(total).toBe(224_000 * NAIRA);
  });

  it('attaches the figures without disturbing the row', () => {
    const row = withBillBalance({
      id: 'bill-1',
      invoiceNumber: 'DN-40318',
      amountDue: 199_800 * NAIRA,
      payments: [{ amount: 71_800 * NAIRA }],
    });

    expect(row.id).toBe('bill-1');
    expect(row.invoiceNumber).toBe('DN-40318');
    expect(row.balance).toBe(128_000 * NAIRA);
  });
});
