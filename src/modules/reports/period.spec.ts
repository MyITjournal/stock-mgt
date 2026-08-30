import {
  addDays,
  addMonths,
  customPeriod,
  dayKey,
  eachDayKey,
  resolvePeriod,
  startOfDay,
  startOfMonth,
} from './period';

const LAGOS = 'Africa/Lagos';

describe('period', () => {
  describe('Africa/Lagos, which is UTC+1 all year', () => {
    // The hour that motivates this whole file: 00:30 UTC is already 01:30 on
    // the same day in Lagos, so the local day started an hour before midnight
    // UTC. Bucketing on the UTC date would file this sale under the 29th.
    it('starts the day at 23:00 UTC the evening before', () => {
      const at = new Date('2026-08-30T00:30:00Z');
      expect(startOfDay(LAGOS, at).toISOString()).toBe(
        '2026-08-29T23:00:00.000Z',
      );
    });

    it('agrees with itself later in the same local day', () => {
      const morning = new Date('2026-08-30T08:00:00Z');
      const evening = new Date('2026-08-30T21:00:00Z');
      expect(startOfDay(LAGOS, morning)).toEqual(startOfDay(LAGOS, evening));
    });

    it('rolls to the next local day at 23:00 UTC', () => {
      const justBefore = new Date('2026-08-30T22:59:59Z');
      const justAfter = new Date('2026-08-30T23:00:00Z');
      expect(dayKey(LAGOS, justBefore)).toBe('2026-08-30');
      expect(dayKey(LAGOS, justAfter)).toBe('2026-08-31');
    });

    it('starts the month at 23:00 UTC on the last of the previous one', () => {
      const at = new Date('2026-08-14T12:00:00Z');
      expect(startOfMonth(LAGOS, at).toISOString()).toBe(
        '2026-07-31T23:00:00.000Z',
      );
    });
  });

  describe('resolvePeriod', () => {
    // 10am Lagos on Sunday 30 August 2026.
    const now = new Date('2026-08-30T09:00:00Z');

    it('bounds today from local midnight to local midnight', () => {
      const period = resolvePeriod('today', LAGOS, now);
      expect(period.from.toISOString()).toBe('2026-08-29T23:00:00.000Z');
      expect(period.to.toISOString()).toBe('2026-08-30T23:00:00.000Z');
    });

    it('bounds yesterday, ending where today begins', () => {
      const yesterday = resolvePeriod('yesterday', LAGOS, now);
      const today = resolvePeriod('today', LAGOS, now);
      expect(yesterday.to).toEqual(today.from);
      expect(yesterday.from.toISOString()).toBe('2026-08-28T23:00:00.000Z');
    });

    it('runs month-to-date from the first of the month', () => {
      const period = resolvePeriod('month', LAGOS, now);
      expect(period.from.toISOString()).toBe('2026-07-31T23:00:00.000Z');
      expect(period.to.toISOString()).toBe('2026-08-30T23:00:00.000Z');
    });

    it('makes last month tile exactly against this one', () => {
      const lastMonth = resolvePeriod('last-month', LAGOS, now);
      const thisMonth = resolvePeriod('month', LAGOS, now);
      expect(lastMonth.from.toISOString()).toBe('2026-06-30T23:00:00.000Z');
      expect(lastMonth.to).toEqual(thisMonth.from);
    });

    it('counts the last 7 days inclusive of today', () => {
      const period = resolvePeriod('last-7-days', LAGOS, now);
      expect(eachDayKey(period)).toHaveLength(7);
      expect(eachDayKey(period).at(-1)).toBe('2026-08-30');
      expect(eachDayKey(period).at(0)).toBe('2026-08-24');
    });

    it('counts the last 30 days inclusive of today', () => {
      expect(
        eachDayKey(resolvePeriod('last-30-days', LAGOS, now)),
      ).toHaveLength(30);
    });

    it('runs the year from 1 January', () => {
      const period = resolvePeriod('year', LAGOS, now);
      expect(period.from.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    });
  });

  describe('ranges are half-open, so periods tile without overlap', () => {
    const now = new Date('2026-08-30T09:00:00Z');

    it('ends one day exactly where the next begins', () => {
      const day = resolvePeriod('today', LAGOS, now);
      expect(addDays(LAGOS, day.from, 1)).toEqual(day.to);
    });

    it('a custom range covers the whole of the last day named', () => {
      const period = customPeriod(
        LAGOS,
        new Date('2026-08-01T12:00:00Z'),
        new Date('2026-08-31T12:00:00Z'),
      );
      expect(period.from.toISOString()).toBe('2026-07-31T23:00:00.000Z');
      // Exclusive end: midnight at the close of the 31st.
      expect(period.to.toISOString()).toBe('2026-08-31T23:00:00.000Z');
      expect(eachDayKey(period)).toHaveLength(31);
    });

    it('a single-day custom range is one day, not zero', () => {
      const day = new Date('2026-08-30T15:00:00Z');
      expect(eachDayKey(customPeriod(LAGOS, day, day))).toEqual(['2026-08-30']);
    });
  });

  describe('month arithmetic', () => {
    it('steps back over a year boundary', () => {
      const january = new Date('2026-01-15T12:00:00Z');
      expect(addMonths(LAGOS, january, -1).toISOString()).toBe(
        '2025-11-30T23:00:00.000Z',
      );
    });

    it('handles February without inventing a 30th', () => {
      const march = new Date('2026-03-31T12:00:00Z');
      expect(addMonths(LAGOS, march, -1).toISOString()).toBe(
        '2026-01-31T23:00:00.000Z',
      );
    });
  });

  // Lagos never shifts, so the two-pass offset lookup is untested by the cases
  // above. These prove it works before the first tenant in a shifting zone
  // finds out the hard way.
  describe('a timezone that observes DST', () => {
    const LONDON = 'Europe/London';

    it('starts the day at midnight UTC in winter', () => {
      const winter = new Date('2026-01-15T12:00:00Z');
      expect(startOfDay(LONDON, winter).toISOString()).toBe(
        '2026-01-15T00:00:00.000Z',
      );
    });

    it('starts the day at 23:00 UTC the night before in summer', () => {
      const summer = new Date('2026-07-15T12:00:00Z');
      expect(startOfDay(LONDON, summer).toISOString()).toBe(
        '2026-07-14T23:00:00.000Z',
      );
    });

    it('still produces 24 hourly-consistent days across the spring change', () => {
      // The clocks go forward on 29 March 2026; that local day is 23 hours long.
      const period = customPeriod(
        LONDON,
        new Date('2026-03-28T12:00:00Z'),
        new Date('2026-03-30T12:00:00Z'),
      );
      expect(eachDayKey(period)).toEqual([
        '2026-03-28',
        '2026-03-29',
        '2026-03-30',
      ]);
    });

    it('does not skip or repeat a day across the autumn change', () => {
      // The clocks go back on 25 October 2026; that local day is 25 hours long.
      const period = customPeriod(
        LONDON,
        new Date('2026-10-24T12:00:00Z'),
        new Date('2026-10-26T12:00:00Z'),
      );
      expect(eachDayKey(period)).toEqual([
        '2026-10-24',
        '2026-10-25',
        '2026-10-26',
      ]);
    });
  });
});
