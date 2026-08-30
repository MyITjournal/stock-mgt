/**
 * Turning "today" and "this month" into UTC instants, in the organization's
 * own timezone.
 *
 * Kept pure and dependency-free — `Intl` is built in — so the boundaries can be
 * tested exhaustively without a database, the same reasoning as `money.ts` and
 * `fefo.ts`.
 *
 * **Why this exists at all.** Rows are stored as UTC instants; an owner asks
 * about a day in Lagos. Bucketing on the raw UTC date puts every sale made
 * between midnight and 1am WAT into the previous day, so "today's takings" is
 * wrong for the first hour of every day and the daily chart is quietly shifted.
 * `Organization.timezone` exists for this; nothing outside this file should do
 * date arithmetic by hand.
 *
 * Ranges are **half-open**: `from` inclusive, `to` exclusive. That is what makes
 * consecutive periods tile without double-counting the row that lands exactly on
 * midnight.
 */

/** A resolved window, as UTC instants ready for a `gte`/`lt` filter. */
export interface Period {
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
  timezone: string;
  /** What was asked for, echoed back so a response can label itself. */
  name: PeriodName | 'custom';
}

export type PeriodName =
  | 'today'
  | 'yesterday'
  | 'month'
  | 'last-month'
  | 'last-7-days'
  | 'last-30-days'
  | 'year';

export const PERIOD_NAMES: readonly PeriodName[] = [
  'today',
  'yesterday',
  'month',
  'last-month',
  'last-7-days',
  'last-30-days',
  'year',
];

interface ZonedFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading a given instant has in a given timezone. */
function zonedFields(timezone: string, at: Date): ZonedFields {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Some ICU builds render midnight as hour 24 rather than 0.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
function offsetMs(timezone: string, at: Date): number {
  const field = zonedFields(timezone, at);
  const asIfUtc = Date.UTC(
    field.year,
    field.month - 1,
    field.day,
    field.hour,
    field.minute,
    field.second,
  );
  // The formatted reading has second precision, so compare like with like.
  return asIfUtc - (at.getTime() - at.getMilliseconds());
}

/**
 * The instant at which a given local wall-clock midnight occurs.
 *
 * Two passes, because the offset has to be looked up *at* the moment being
 * resolved and the first guess may land on the wrong side of a DST change.
 * Africa/Lagos never shifts, so the second pass is a no-op there — it is here
 * so the first tenant in a zone that does shift is not a bug report.
 */
export function zonedStartOfDay(
  timezone: string,
  year: number,
  month: number,
  day: number,
): Date {
  const asIfUtc = Date.UTC(year, month - 1, day, 0, 0, 0);

  const firstGuess = asIfUtc - offsetMs(timezone, new Date(asIfUtc));
  const corrected = asIfUtc - offsetMs(timezone, new Date(firstGuess));

  return new Date(corrected);
}

/** Midnight, in `timezone`, of the day `at` falls on. */
export function startOfDay(timezone: string, at: Date): Date {
  const { year, month, day } = zonedFields(timezone, at);
  return zonedStartOfDay(timezone, year, month, day);
}

/** Midnight, in `timezone`, of the first of the month `at` falls in. */
export function startOfMonth(timezone: string, at: Date): Date {
  const { year, month } = zonedFields(timezone, at);
  return zonedStartOfDay(timezone, year, month, 1);
}

/** `count` local days after the local day `at` falls on. */
export function addDays(timezone: string, at: Date, count: number): Date {
  const { year, month, day } = zonedFields(timezone, at);
  return zonedStartOfDay(timezone, year, month, day + count);
}

/** `count` local months after the month `at` falls in, at the first of it. */
export function addMonths(timezone: string, at: Date, count: number): Date {
  const { year, month } = zonedFields(timezone, at);
  return zonedStartOfDay(timezone, year, month + count, 1);
}

/**
 * `YYYY-MM-DD` as read in `timezone` — the key a daily bucket is grouped on.
 *
 * Grouping happens on this rather than on the UTC date for the reason in the
 * file header: the two disagree for an hour of every day in Lagos.
 */
export function dayKey(timezone: string, at: Date): string {
  const { year, month, day } = zonedFields(timezone, at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Resolves a named period against a clock. */
export function resolvePeriod(
  name: PeriodName,
  timezone: string,
  now: Date = new Date(),
): Period {
  const period = (from: Date, to: Date): Period => ({
    from,
    to,
    timezone,
    name,
  });

  const todayStart = startOfDay(timezone, now);
  const tomorrow = addDays(timezone, now, 1);

  switch (name) {
    case 'today':
      return period(todayStart, tomorrow);

    case 'yesterday':
      return period(addDays(timezone, now, -1), todayStart);

    case 'month':
      return period(startOfMonth(timezone, now), tomorrow);

    case 'last-month': {
      const start = addMonths(timezone, now, -1);
      return period(start, startOfMonth(timezone, now));
    }

    // Inclusive of today, so "last 7 days" is a week ending now, not a week
    // ending last night.
    case 'last-7-days':
      return period(addDays(timezone, now, -6), tomorrow);

    case 'last-30-days':
      return period(addDays(timezone, now, -29), tomorrow);

    case 'year': {
      const { year } = zonedFields(timezone, now);
      return period(zonedStartOfDay(timezone, year, 1, 1), tomorrow);
    }
  }
}

/**
 * An explicit range. `from` and `to` are read as **local dates**, and `to` is
 * treated as inclusive of the whole day the caller named — asking for
 * `to=2026-08-30` means "up to the end of the 30th", which is what someone
 * typing a date into a report expects.
 */
export function customPeriod(timezone: string, from: Date, to: Date): Period {
  return {
    from: startOfDay(timezone, from),
    to: addDays(timezone, to, 1),
    timezone,
    name: 'custom',
  };
}

/** Every local day in a period, as `YYYY-MM-DD`, so a chart has no gaps. */
export function eachDayKey(period: Period): string[] {
  const keys: string[] = [];
  let cursor = period.from;

  // Guarded rather than `while (true)`: a malformed period should not spin.
  for (let guard = 0; guard < 1_000 && cursor < period.to; guard += 1) {
    keys.push(dayKey(period.timezone, cursor));
    cursor = addDays(period.timezone, cursor, 1);
  }

  return keys;
}
