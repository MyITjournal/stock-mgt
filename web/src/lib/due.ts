/**
 * "3 days overdue", "Due today", "Due in 2 days" — the server's count, in words.
 *
 * `daysPastDue` always comes from the server, counted in the shop's timezone
 * (§6): the browser never works out which day it is. This only says it, and
 * picks the colour — red once late, amber on the day, plain before.
 */
export function dueStatus(daysPastDue: number): { text: string; tone: string } {
  if (daysPastDue > 0) {
    return {
      text: `${daysPastDue} day${daysPastDue === 1 ? '' : 's'} overdue`,
      tone: 'font-medium text-red-700',
    };
  }
  if (daysPastDue === 0) {
    return { text: 'Due today', tone: 'font-medium text-amber-700' };
  }
  const left = -daysPastDue;
  return {
    text: `Due in ${left} day${left === 1 ? '' : 's'}`,
    tone: 'text-slate-600',
  };
}
