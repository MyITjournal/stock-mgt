import { CREDIT_DAYS, daysPastDue, dueDateFor } from './due';

const LAGOS = 'Africa/Lagos';

describe('dueDateFor', () => {
  it('is the start of the fifth day after the sale, in the shop’s timezone', () => {
    // 10:00 Lagos on the 6th → due on the 11th.
    const due = dueDateFor(LAGOS, new Date('2026-10-06T09:00:00Z'));
    expect(CREDIT_DAYS).toBe(5);
    // Midnight in Lagos (UTC+1) is 23:00 the evening before in UTC.
    expect(due.toISOString()).toBe('2026-10-10T23:00:00.000Z');
  });

  it('counts a sale late in the evening as that day’s sale', () => {
    // 23:30 Lagos on the 6th is 22:30 UTC — still the 6th, due the 11th.
    const due = dueDateFor(LAGOS, new Date('2026-10-06T22:30:00Z'));
    expect(due.toISOString()).toBe('2026-10-10T23:00:00.000Z');
  });
});

describe('daysPastDue', () => {
  const due = new Date('2026-10-10T23:00:00Z'); // the 11th, in Lagos

  it('is 0 on the due day itself, whatever the hour', () => {
    expect(daysPastDue(LAGOS, due, new Date('2026-10-11T08:00:00Z'))).toBe(0);
    expect(daysPastDue(LAGOS, due, new Date('2026-10-11T22:30:00Z'))).toBe(0);
  });

  it('counts days overdue, and days left before it', () => {
    expect(daysPastDue(LAGOS, due, new Date('2026-10-13T12:00:00Z'))).toBe(2);
    expect(daysPastDue(LAGOS, due, new Date('2026-10-09T12:00:00Z'))).toBe(-2);
  });
});
