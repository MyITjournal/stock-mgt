/** Today as a date box shows it, in the browser's own calendar. */
export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * What to send as `occurredAt` for a picked day: nothing for today — the
 * server's own clock, as before — and noon UTC on any earlier day.
 *
 * The box gives a calendar day and the server wants a moment. Midnight UTC
 * would land on the day before for anyone west of Greenwich; noon UTC is the
 * same calendar day everywhere from UTC−11 to UTC+11, Lagos included, so the
 * payment falls in the month that was picked when reports resolve it in the
 * shop's timezone (§6). The browser works out which day, never a period.
 */
export function occurredAtFor(day: string): { occurredAt?: string } {
  return day && day !== today() ? { occurredAt: `${day}T12:00:00.000Z` } : {};
}
