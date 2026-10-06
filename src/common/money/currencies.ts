/**
 * The currencies a shop may keep its books in (§2, 2026-10-06).
 *
 * **One per shop, never mixed.** Every amount in the database is an integer of
 * this currency's hundredths, so a shop is in naira *or* cedis, and a customer
 * paying in another currency is recorded at what the shop accepted for it, with
 * the foreign amount in the payment's reference. Several currencies inside one
 * shop means exchange rates and gains and losses on them, which is accounting.
 *
 * Every currency here has exactly two decimal places, which is what the integer
 * minor units assume. The West African CFA franc (XOF) has none, so adding it is
 * a change to how amounts are entered and shown — not one more line in this list.
 */
export const SUPPORTED_CURRENCIES = [
  'NGN',
  'USD',
  'GBP',
  'EUR',
  'GHS',
  'KES',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = 'NGN';

/**
 * Where a shop keeping its books in this currency most likely is — a starting
 * point only, used when sign-up was not told the owner's own time zone.
 * A Lagos importer pricing in dollars is still on Lagos time, which is why the
 * browser's zone wins whenever it is sent.
 */
const HOME_TIMEZONE: Record<SupportedCurrency, string> = {
  NGN: 'Africa/Lagos',
  USD: 'America/New_York',
  GBP: 'Europe/London',
  EUR: 'Europe/Berlin',
  GHS: 'Africa/Accra',
  KES: 'Africa/Nairobi',
};

/** True for a zone this runtime can resolve dates in. */
export function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The zone a new shop starts in: the owner's own if known, else the currency's home. */
export function startingTimezone(
  currency: SupportedCurrency,
  ownersZone?: string,
): string {
  return ownersZone && isTimezone(ownersZone)
    ? ownersZone
    : HOME_TIMEZONE[currency];
}
