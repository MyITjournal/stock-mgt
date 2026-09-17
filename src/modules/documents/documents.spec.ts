import { presentLines, printDate, printMoney } from './pdf';
import {
  Letterhead,
  PayableAccount,
  invoiceDefinition,
  payableBlock,
} from './invoice';

const ORG: Letterhead = {
  name: 'Adebayo Stores Limited',
  address: '12 Oba Akran Avenue, Ikeja',
  phone: '+2348012345678',
  email: 'sales@adebayo.ng',
  taxId: '01234567-0001',
  rcNumber: 'RC 1234567',
  logoUrl: null,
  currency: 'NGN',
  timezone: 'Africa/Lagos',
};

const account = (bankName: string, accountNumber: string): PayableAccount => ({
  bankName,
  accountName: 'Adebayo Stores Limited',
  accountNumber,
});

describe('printMoney', () => {
  it('prints the currency code rather than a symbol', () => {
    // The built-in PDF fonts carry no ₦ glyph, and a missing glyph renders as a
    // blank box on a document a customer is meant to pay from.
    expect(printMoney(250_000)).toBe('NGN 2,500.00');
  });

  it('always shows two decimal places', () => {
    expect(printMoney(250_000_000)).toBe('NGN 2,500,000.00');
    expect(printMoney(5)).toBe('NGN 0.05');
  });

  it('puts the sign before the currency, not inside the number', () => {
    expect(printMoney(-600_000)).toBe('-NGN 6,000.00');
  });

  it('prints zero rather than omitting it', () => {
    expect(printMoney(0)).toBe('NGN 0.00');
  });
});

describe('printDate', () => {
  it('reads the date in the organization timezone, not UTC', () => {
    // 23:30 UTC is already the next day in Lagos. A document dated a day out is
    // the same class of bug as a period that rolls over at 1am (§12).
    //
    // Asserted on the day rather than the whole string: the month abbreviation
    // comes from the platform's ICU data ("Sep" or "Sept" depending on the Node
    // build), and pinning it would make this fail on an upgrade for a reason
    // that has nothing to do with timezones.
    const lateUtc = new Date('2026-09-17T23:30:00.000Z');

    expect(printDate(lateUtc, 'Africa/Lagos')).toMatch(/^18 \w+ 2026$/);
    expect(printDate(lateUtc, 'UTC')).toMatch(/^17 \w+ 2026$/);
  });
});

describe('presentLines', () => {
  it('drops what a business has not filled in', () => {
    expect(presentLines('12 Oba Akran', null, undefined, '+234801')).toBe(
      '12 Oba Akran\n+234801',
    );
  });

  it('returns nothing when everything is missing', () => {
    expect(presentLines(null, undefined, '  ')).toBe('');
  });
});

describe('payableBlock', () => {
  it('prints nothing at all when no account is set up', () => {
    // Rather than an empty "Pay into" heading, which reads as a mistake.
    expect(payableBlock([])).toEqual([]);
  });

  it('lists several accounts, because a business keeps several on purpose', () => {
    const block = JSON.stringify(
      payableBlock([
        account('Guaranty Trust Bank', '0123456789'),
        account('Zenith Bank', '1010101010'),
      ]),
    );

    expect(block).toContain('Guaranty Trust Bank');
    expect(block).toContain('1010101010');
  });

  it('keeps a fourth and fifth account on the page rather than dropping them', () => {
    // Five accounts is not unusual; silently printing only three would send a
    // customer to a bank the invoice never mentioned.
    const block = JSON.stringify(
      payableBlock([
        account('GTBank', '0000000001'),
        account('Zenith', '0000000002'),
        account('Access', '0000000003'),
        account('UBA', '0000000004'),
        account('First Bank', '0000000005'),
      ]),
    );

    expect(block).toContain('0000000004');
    expect(block).toContain('0000000005');
  });
});

describe('invoiceDefinition', () => {
  const invoice = {
    number: 'INV-0001',
    occurredAt: new Date('2026-09-17T10:00:00.000Z'),
    customer: 'Chidi Provisions',
    servedBy: 'Ibrahim',
    lines: [
      {
        description: 'Peak Milk 400g',
        unit: 'carton',
        quantity: 2,
        unitPrice: 5_400_000,
        lineTotal: 10_800_000,
      },
    ],
    total: 10_800_000,
    tax: 753_488,
    paid: 4_000_000,
    balance: 6_800_000,
    note: null,
  };

  it('shows VAT as part of the total, never added on top', () => {
    // Prices are stored tax-inclusive (§2). Printing VAT as an addition would
    // overstate the bill by 7.5% on a document someone pays from.
    const doc = JSON.stringify(
      invoiceDefinition({ organization: ORG, accounts: [], invoice }),
    );

    expect(doc).toContain('of which VAT');
    expect(doc).toContain('Balance due');
  });

  it('renders for a business that has filled nothing in', () => {
    // The letterhead fields are all nullable on purpose: a business that never
    // visited the profile screen still has to be able to invoice today.
    const bare: Letterhead = {
      ...ORG,
      address: null,
      phone: null,
      email: null,
      taxId: null,
      rcNumber: null,
    };

    const doc = invoiceDefinition({
      organization: bare,
      accounts: [],
      invoice,
    });

    expect(JSON.stringify(doc)).toContain('Adebayo Stores Limited');
    expect(() => JSON.stringify(doc)).not.toThrow();
  });
});
