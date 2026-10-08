import { splitTaxInclusive } from '../../common/money/money';
import {
  planSaleCorrection,
  type PaymentOnSale,
  type RecordedSale,
} from './sale-correction';

const money = (minor: number) => `₦${(minor / 100).toFixed(2)}`;

/**
 * Two cartons at ₦10,000 and a ₦5,000 pack, 7.5% VAT on the cartons and none
 * on the pack — ₦25,000, paid in full at the till.
 */
const CARTONS = {
  id: 'line-cartons',
  quantity: 2,
  unitPrice: 1_000_000,
  lineTotal: 2_000_000,
  taxRateBps: 750,
  taxAmount: splitTaxInclusive(2_000_000, 750).tax,
};
const PACK = {
  id: 'line-pack',
  quantity: 1,
  unitPrice: 500_000,
  lineTotal: 500_000,
  taxRateBps: 0,
  taxAmount: 0,
};

const AT_THE_TILL: PaymentOnSale = {
  id: 'pay-till',
  amount: 2_500_000,
  allocatedHere: 2_500_000,
  allocatedElsewhere: false,
  voided: false,
  occurredAt: new Date('2026-10-08T09:00:00Z'),
};

function sale(overrides: Partial<RecordedSale> = {}): RecordedSale {
  return {
    customerId: 'cust-ade',
    total: 2_500_000,
    taxTotal: CARTONS.taxAmount,
    lines: [CARTONS, PACK],
    hasReturns: false,
    payments: [AT_THE_TILL],
    ...overrides,
  };
}

function planned(plan: ReturnType<typeof planSaleCorrection>) {
  if (plan.refused) throw new Error(plan.refused.message);
  return plan;
}

describe('planSaleCorrection — prices', () => {
  it('lowers a price, re-splits its VAT, and brings the till payment down with it', () => {
    const plan = planned(
      planSaleCorrection(
        sale(),
        { lines: [{ lineId: CARTONS.id, unitPrice: 900_000 }] },
        money,
      ),
    );

    expect(plan.lineChanges).toHaveLength(1);
    expect(plan.lineChanges[0]).toMatchObject({
      unitPrice: 900_000,
      lineTotal: 1_800_000,
      taxAmount: splitTaxInclusive(1_800_000, 750).tax,
    });
    expect(plan.totalAfter).toBe(2_300_000);
    expect(plan.taxTotalAfter).toBe(splitTaxInclusive(1_800_000, 750).tax);
    // ₦25,000 was recorded as taken; ₦23,000 really was.
    expect(plan.paidBefore).toBe(2_500_000);
    expect(plan.paidAfter).toBe(2_300_000);
    expect(plan.follows).toEqual({ paymentId: 'pay-till', amount: 2_300_000 });
    expect(plan.customerChanged).toBe(false);
    expect(plan.movePaymentIds).toEqual([]);
  });

  it('leaves a line whose price is sent unchanged alone', () => {
    const plan = planned(
      planSaleCorrection(
        sale(),
        {
          lines: [
            { lineId: CARTONS.id, unitPrice: 1_000_000 },
            { lineId: PACK.id, unitPrice: 400_000 },
          ],
        },
        money,
      ),
    );
    expect(plan.lineChanges.map((row) => row.line.id)).toEqual([PACK.id]);
    expect(plan.totalAfter).toBe(2_400_000);
  });

  it('lowers only what is owed on a sale that went out on credit', () => {
    const plan = planned(
      planSaleCorrection(
        sale({ payments: [] }),
        { lines: [{ lineId: PACK.id, unitPrice: 0 }] },
        money,
      ),
    );
    expect(plan.totalAfter).toBe(2_000_000);
    expect(plan.paidAfter).toBe(0);
    expect(plan.follows).toBeNull();
  });

  it('leaves a part payment alone while it is still within the new total', () => {
    const part = {
      ...AT_THE_TILL,
      amount: 1_000_000,
      allocatedHere: 1_000_000,
    };
    const plan = planned(
      planSaleCorrection(
        sale({ payments: [part] }),
        { lines: [{ lineId: CARTONS.id, unitPrice: 900_000 }] },
        money,
      ),
    );
    expect(plan.follows).toBeNull();
    expect(plan.paidAfter).toBe(1_000_000);
  });

  it('raises a price without touching the payment, so the difference is owed', () => {
    const plan = planned(
      planSaleCorrection(
        sale(),
        { lines: [{ lineId: PACK.id, unitPrice: 600_000 }] },
        money,
      ),
    );
    expect(plan.totalAfter).toBe(2_600_000);
    expect(plan.paidAfter).toBe(2_500_000);
    expect(plan.follows).toBeNull();
  });

  it('voids the till payment outright when the sale comes to nothing', () => {
    const plan = planned(
      planSaleCorrection(
        sale(),
        {
          lines: [
            { lineId: CARTONS.id, unitPrice: 0 },
            { lineId: PACK.id, unitPrice: 0 },
          ],
        },
        money,
      ),
    );
    expect(plan.follows).toEqual({ paymentId: 'pay-till', amount: 0 });
    expect(plan.paidAfter).toBe(0);
  });

  it('brings down the latest payment that can take the whole excess', () => {
    const first = {
      ...AT_THE_TILL,
      amount: 1_500_000,
      allocatedHere: 1_500_000,
    };
    const later = {
      ...AT_THE_TILL,
      id: 'pay-later',
      amount: 1_000_000,
      allocatedHere: 1_000_000,
      occurredAt: new Date('2026-10-09T09:00:00Z'),
    };
    const plan = planned(
      planSaleCorrection(
        sale({ payments: [first, later] }),
        { lines: [{ lineId: PACK.id, unitPrice: 0 }] },
        money,
      ),
    );
    expect(plan.follows).toEqual({ paymentId: 'pay-later', amount: 500_000 });
  });

  it('ignores voided payments, which never settled anything', () => {
    const voided = { ...AT_THE_TILL, id: 'pay-void', voided: true };
    const plan = planned(
      planSaleCorrection(
        sale({ payments: [voided] }),
        { lines: [{ lineId: PACK.id, unitPrice: 0 }] },
        money,
      ),
    );
    expect(plan.paidBefore).toBe(0);
    expect(plan.follows).toBeNull();
  });

  it('refuses when no single payment can be brought down — void the extra first', () => {
    // ₦25,000 paid in one transfer that also cleared another invoice.
    const shared = {
      ...AT_THE_TILL,
      amount: 4_000_000,
      allocatedElsewhere: true,
    };
    const plan = planSaleCorrection(
      sale({ payments: [shared] }),
      { lines: [{ lineId: PACK.id, unitPrice: 0 }] },
      money,
    );
    expect(plan.refused?.status).toBe(409);
    expect(plan.refused?.message).toContain('Void the payment');
    expect(plan.refused?.message).toContain('₦20000.00');
  });

  it('refuses a price change once goods have come back', () => {
    const plan = planSaleCorrection(
      sale({ hasReturns: true }),
      { lines: [{ lineId: PACK.id, unitPrice: 400_000 }] },
      money,
    );
    expect(plan.refused?.status).toBe(409);
    expect(plan.refused?.message).toContain('already come back');
  });

  it('refuses a line that is not on the sale, or the same line twice', () => {
    expect(
      planSaleCorrection(
        sale(),
        { lines: [{ lineId: 'line-other', unitPrice: 1 }] },
        money,
      ).refused?.status,
    ).toBe(400);
    expect(
      planSaleCorrection(
        sale(),
        {
          lines: [
            { lineId: PACK.id, unitPrice: 1 },
            { lineId: PACK.id, unitPrice: 2 },
          ],
        },
        money,
      ).refused?.status,
    ).toBe(400);
  });

  it('refuses a correction that changes nothing', () => {
    const plan = planSaleCorrection(
      sale(),
      {
        customerId: 'cust-ade',
        lines: [{ lineId: PACK.id, unitPrice: 500_000 }],
      },
      money,
    );
    expect(plan.refused?.status).toBe(400);
    expect(plan.refused?.message).toContain('Nothing has changed');
  });
});

describe('planSaleCorrection — the customer', () => {
  it('moves the sale and the payments that settled only it', () => {
    const voided = { ...AT_THE_TILL, id: 'pay-void', voided: true };
    const plan = planned(
      planSaleCorrection(
        sale({ payments: [AT_THE_TILL, voided] }),
        { customerId: 'cust-bisi' },
        money,
      ),
    );
    expect(plan.customerChanged).toBe(true);
    expect(plan.customerIdAfter).toBe('cust-bisi');
    expect(plan.movePaymentIds).toEqual(['pay-till', 'pay-void']);
    expect(plan.totalAfter).toBe(2_500_000);
    expect(plan.lineChanges).toEqual([]);
  });

  it('makes a walk-in a named customer, and back', () => {
    const named = planned(
      planSaleCorrection(
        sale({ customerId: null }),
        { customerId: 'cust-ade' },
        money,
      ),
    );
    expect(named.customerIdAfter).toBe('cust-ade');

    const walkIn = planned(
      planSaleCorrection(sale(), { customerId: null }, money),
    );
    expect(walkIn.customerChanged).toBe(true);
    expect(walkIn.customerIdAfter).toBeNull();
  });

  it('treats an omitted customer as unchanged', () => {
    const plan = planned(
      planSaleCorrection(
        sale(),
        { lines: [{ lineId: PACK.id, unitPrice: 400_000 }] },
        money,
      ),
    );
    expect(plan.customerChanged).toBe(false);
    expect(plan.customerIdAfter).toBe('cust-ade');
  });

  it('refuses while a payment on it also paid other invoices', () => {
    const shared = {
      ...AT_THE_TILL,
      amount: 4_000_000,
      allocatedElsewhere: true,
    };
    const plan = planSaleCorrection(
      sale({ payments: [shared] }),
      { customerId: 'cust-bisi' },
      money,
    );
    expect(plan.refused?.status).toBe(409);
    expect(plan.refused?.message).toContain('also paid other invoices');
  });

  it('moves the customer even after a return — only prices are closed by one', () => {
    const plan = planned(
      planSaleCorrection(
        sale({ hasReturns: true }),
        { customerId: 'cust-bisi' },
        money,
      ),
    );
    expect(plan.customerChanged).toBe(true);
  });

  it('does both at once: a lower price, and the payment brought down and moved', () => {
    const plan = planned(
      planSaleCorrection(
        sale(),
        {
          customerId: 'cust-bisi',
          lines: [{ lineId: PACK.id, unitPrice: 400_000 }],
        },
        money,
      ),
    );
    expect(plan.follows).toEqual({ paymentId: 'pay-till', amount: 2_400_000 });
    expect(plan.movePaymentIds).toEqual(['pay-till']);
  });
});
