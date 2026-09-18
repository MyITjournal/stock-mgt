import {
  formatMinutes,
  isWithinWorkingHours,
  localClock,
  resolveHours,
} from './working-hours';

const LAGOS = 'Africa/Lagos';

/** The shop: 08:00–19:00, open every day. */
const SHOP = {
  opensAt: 480,
  closesAt: 1140,
  workingDays: [0, 1, 2, 3, 4, 5, 6],
};
const INHERITS = { opensAt: null, closesAt: null, workingDays: [] };

describe('resolveHours', () => {
  it('gives a new employee the shop hours without anybody setting them', () => {
    // The whole reason hours are not held per person alone: a new starter needs
    // a default, and both available answers are wrong.
    expect(resolveHours({ organization: SHOP, membership: INHERITS })).toEqual(
      SHOP,
    );
  });

  it('lets one person work different hours', () => {
    const morningOnly = resolveHours({
      organization: SHOP,
      membership: { opensAt: 360, closesAt: 720, workingDays: [] },
    });

    expect(morningOnly.opensAt).toBe(360);
    expect(morningOnly.closesAt).toBe(720);
    // Days were not overridden, so they still follow the shop.
    expect(morningOnly.workingDays).toEqual(SHOP.workingDays);
  });

  it('lets somebody work the shop hours on Saturdays only', () => {
    const saturdayOnly = resolveHours({
      organization: SHOP,
      membership: { ...INHERITS, workingDays: [6] },
    });

    expect(saturdayOnly.workingDays).toEqual([6]);
    expect(saturdayOnly.opensAt).toBe(SHOP.opensAt);
  });

  it('ignores a half-set override', () => {
    // An opening time with no closing time is not a meaningful arrangement, so
    // it falls back rather than inventing the missing half.
    const half = resolveHours({
      organization: SHOP,
      membership: { opensAt: 360, closesAt: null, workingDays: [] },
    });

    expect(half.opensAt).toBe(SHOP.opensAt);
  });
});

describe('localClock', () => {
  it('reads the clock in the business timezone, not UTC', () => {
    // 23:30 UTC is 00:30 the next day in Lagos. Reading this in UTC is the same
    // bug as a period that rolls over at 1am (§12) — a cashier would be told
    // the shop is closed on a day it is open.
    const lateUtc = new Date('2026-09-18T23:30:00.000Z');

    expect(localClock(lateUtc, LAGOS).minutes).toBe(30);
    expect(localClock(lateUtc, 'UTC').minutes).toBe(23 * 60 + 30);
    expect(localClock(lateUtc, LAGOS).day).not.toBe(
      localClock(lateUtc, 'UTC').day,
    );
  });

  it('reads midnight as the start of the day', () => {
    // Some ICU builds format midnight as hour 24, which would put it past every
    // closing time instead of before every opening one.
    const midnightLagos = new Date('2026-09-17T23:00:00.000Z');

    expect(localClock(midnightLagos, LAGOS).minutes).toBe(0);
  });
});

describe('isWithinWorkingHours', () => {
  /** A Friday in Lagos, at the given local hour and minute. */
  const lagosAt = (hour: number, minute = 0) =>
    new Date(
      Date.UTC(2026, 8, 18, hour - 1, minute), // Lagos is UTC+1, no DST
    );

  it('allows somebody arriving mid-morning', () => {
    expect(isWithinWorkingHours(lagosAt(9), LAGOS, SHOP).allowed).toBe(true);
  });

  it('allows the very first minute of the day', () => {
    expect(isWithinWorkingHours(lagosAt(8, 0), LAGOS, SHOP).allowed).toBe(true);
  });

  it('refuses somebody arriving before opening', () => {
    const verdict = isWithinWorkingHours(lagosAt(7, 30), LAGOS, SHOP);

    expect(verdict.allowed).toBe(false);
    // The message names the hours, so a cashier at the door knows to wait
    // rather than thinking the app is broken.
    expect(verdict.reason).toContain('08:00');
    expect(verdict.reason).toContain('19:00');
  });

  it('refuses the closing minute itself, so the window is exclusive at the end', () => {
    expect(isWithinWorkingHours(lagosAt(19, 0), LAGOS, SHOP).allowed).toBe(
      false,
    );
    expect(isWithinWorkingHours(lagosAt(18, 59), LAGOS, SHOP).allowed).toBe(
      true,
    );
  });

  it('refuses a day the shop does not open', () => {
    // Closed Sundays: 0 dropped from the list.
    const weekdays = { ...SHOP, workingDays: [1, 2, 3, 4, 5, 6] };
    const sunday = new Date(Date.UTC(2026, 8, 20, 11, 0));

    const verdict = isWithinWorkingHours(sunday, LAGOS, weekdays);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('closed today');
  });

  it('judges the same instant differently in two timezones', () => {
    // 07:30 in Lagos is 06:30 UTC. The business timezone is the only one that
    // decides whether the shop is open.
    const early = new Date('2026-09-18T06:30:00.000Z');

    expect(isWithinWorkingHours(early, LAGOS, SHOP).allowed).toBe(false);
    expect(isWithinWorkingHours(early, 'Africa/Nairobi', SHOP).allowed).toBe(
      true,
    );
  });
});

describe('formatMinutes', () => {
  it('reads as a clock time', () => {
    expect(formatMinutes(480)).toBe('08:00');
    expect(formatMinutes(1140)).toBe('19:00');
    expect(formatMinutes(0)).toBe('00:00');
    expect(formatMinutes(605)).toBe('10:05');
  });
});
