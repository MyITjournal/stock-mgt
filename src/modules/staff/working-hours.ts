/**
 * When a member of staff may sign in.
 *
 * Pure, like `period.ts` and `purchase-target.ts`, because the whole feature is
 * a comparison and a fallback — both worth testing without a database in the
 * way, and both easy to get subtly wrong in a timezone.
 */

/** Minutes past midnight, local to the business. 480 is 08:00. */
export interface WorkingHours {
  opensAt: number;
  closesAt: number;
  /** 0 is Sunday, matching `Date.getDay()`. */
  workingDays: number[];
}

/** What a business set, and what this one person's row overrides. */
export interface HoursSource {
  organization: WorkingHours;
  membership: {
    opensAt: number | null;
    closesAt: number | null;
    workingDays: number[];
  };
}

/**
 * The hours that actually apply to one person.
 *
 * The business is the default and the person is the exception. Held only per
 * person, a new employee would need a default of their own, and both available
 * answers are wrong: "any time" quietly exempts the newest and least-known
 * member of staff, "never" stops them working on their first morning.
 *
 * Times move together — a row with an opening time and no closing time is not a
 * meaningful half-override — while days are independent, because "same hours,
 * Saturdays only" is a real arrangement.
 */
export function resolveHours(source: HoursSource): WorkingHours {
  const { organization, membership } = source;

  const hasOwnTimes =
    membership.opensAt !== null && membership.closesAt !== null;

  return {
    opensAt: hasOwnTimes ? membership.opensAt! : organization.opensAt,
    closesAt: hasOwnTimes ? membership.closesAt! : organization.closesAt,
    workingDays:
      membership.workingDays.length > 0
        ? membership.workingDays
        : organization.workingDays,
  };
}

/**
 * The local day and minute-of-day in a timezone.
 *
 * Read through `Intl` rather than by adding an offset, because an offset is a
 * number somebody has to keep correct and this is the same class of bug as
 * "today" rolling over at 1am (§12).
 */
export function localClock(
  now: Date,
  timezone: string,
): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // `hour` can read "24" at midnight in some ICU builds; normalise it to 0 so
  // midnight is the start of a day rather than the end of the previous one.
  const hour = Number(read('hour')) % 24;

  return {
    day: days.indexOf(read('weekday')),
    minutes: hour * 60 + Number(read('minute')),
  };
}

export interface HoursVerdict {
  allowed: boolean;
  /** Why not, in words a cashier at the door can act on. */
  reason?: string;
}

/**
 * Whether somebody may start a session right now.
 *
 * The window never crosses midnight — there is no night shift yet, and the
 * database refuses a closing time before an opening one — so this stays a
 * single comparison. Supporting a night shift means two ranges and a different
 * shape of test, which is why it is a later version rather than a flag.
 */
export function isWithinWorkingHours(
  now: Date,
  timezone: string,
  hours: WorkingHours,
): HoursVerdict {
  const { day, minutes } = localClock(now, timezone);

  if (!hours.workingDays.includes(day)) {
    return { allowed: false, reason: 'The business is closed today.' };
  }

  if (minutes < hours.opensAt || minutes >= hours.closesAt) {
    return {
      allowed: false,
      reason: `You can sign in between ${formatMinutes(hours.opensAt)} and ${formatMinutes(hours.closesAt)}.`,
    };
  }

  return { allowed: true };
}

/** 480 reads as "08:00" — for a message somebody has to act on. */
export function formatMinutes(value: number): string {
  const hours = Math.floor(value / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (value % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}
