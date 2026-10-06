import { addDays, startOfDay } from '../reports/period';

/**
 * When a sale on credit should be paid, and how far past that it is.
 *
 * **Five days**, the owner's rule (2026-10-06): a customer who takes goods and
 * pays later is due on the fifth day after the sale. Counted in **calendar
 * days in the shop's timezone** — a sale at 11pm in Lagos is that day's sale —
 * which is why it goes through `period.ts`, where every date rule lives.
 */
export const CREDIT_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day a credit sale made at `occurredAt` is due: its start, in the shop's zone. */
export function dueDateFor(timezone: string, occurredAt: Date): Date {
  return startOfDay(timezone, addDays(timezone, occurredAt, CREDIT_DAYS));
}

/**
 * Whole days past the due day: positive once overdue, 0 on the day itself,
 * negative while there are days left. Compared day to day in the shop's zone,
 * so "due today" does not flip at 1am.
 */
export function daysPastDue(
  timezone: string,
  dueDate: Date,
  now: Date,
): number {
  const today = startOfDay(timezone, now).getTime();
  const due = startOfDay(timezone, dueDate).getTime();
  return Math.round((today - due) / DAY_MS);
}
