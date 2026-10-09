import { PaymentMethod } from '@prisma/client';
import { paidByMethod } from './receipt';

const at = (day: number) => new Date(Date.UTC(2026, 9, day, 10));
const paid = (
  method: PaymentMethod,
  amount: number,
  day: number,
  voidedAt: Date | null = null,
) => ({ amount, payment: { method, occurredAt: at(day), voidedAt } });

describe('paidByMethod', () => {
  it('says how a sale paid at the counter was paid', () => {
    expect(paidByMethod([paid(PaymentMethod.cash, 500_000, 1)])).toEqual([
      { method: PaymentMethod.cash, amount: 500_000 },
    ]);
  });

  it('sums each method, in the order the money came in', () => {
    expect(
      paidByMethod([
        paid(PaymentMethod.cash, 200_000, 3),
        paid(PaymentMethod.transfer, 300_000, 1),
        paid(PaymentMethod.transfer, 100_000, 5),
      ]),
    ).toEqual([
      { method: PaymentMethod.transfer, amount: 400_000 },
      { method: PaymentMethod.cash, amount: 200_000 },
    ]);
  });

  it('takes cash handed back off the cash paid, and drops a method that nets to nothing', () => {
    expect(
      paidByMethod([
        paid(PaymentMethod.cash, 500_000, 1),
        paid(PaymentMethod.pos, 300_000, 1),
        paid(PaymentMethod.cash, -200_000, 2),
        paid(PaymentMethod.pos, -300_000, 2),
      ]),
    ).toEqual([{ method: PaymentMethod.cash, amount: 300_000 }]);
  });

  it('never counts a voided payment', () => {
    expect(
      paidByMethod([
        paid(PaymentMethod.cash, 500_000, 1, at(1)),
        paid(PaymentMethod.transfer, 400_000, 2),
      ]),
    ).toEqual([{ method: PaymentMethod.transfer, amount: 400_000 }]);
  });

  it('has nothing to say about a sale nobody has paid', () => {
    expect(paidByMethod([])).toEqual([]);
  });
});
