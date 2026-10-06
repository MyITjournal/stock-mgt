import { createContext, useContext } from 'react';

/**
 * The currency the signed-in shop keeps its books in (§2, 2026-10-06).
 *
 * Read once from `GET /organization` by `ShopCurrencyProvider` and used as
 * `<Money>`'s default, so the forty-odd screens that show an amount never pass
 * one. Naira until the shop is known — which is also every shop that never
 * chose, so a page that renders before the request lands reads right for most.
 */
export const ShopCurrencyContext = createContext<string>('NGN');

export function useShopCurrency(): string {
  return useContext(ShopCurrencyContext);
}

/**
 * The currencies a shop may choose, in the order the picker lists them.
 * Mirrors `SUPPORTED_CURRENCIES` on the server, which refuses anything else.
 */
export const CURRENCY_CHOICES = [
  { code: 'NGN', label: 'Nigerian naira (₦)' },
  { code: 'USD', label: 'US dollar ($)' },
  { code: 'GBP', label: 'British pound (£)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'GHS', label: 'Ghanaian cedi (GH₵)' },
  { code: 'KES', label: 'Kenyan shilling (KES)' },
] as const;

/**
 * Time zones offered in Settings: the home of each currency above, plus the
 * other zones a shop using them is likely to be in. The shop's current zone is
 * always added if it is not one of these, so the picker never hides it.
 */
export const TIMEZONE_CHOICES = [
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
] as const;

/** The browser's own zone, sent at sign-up so a shop starts on its owner's clock. */
export function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Strips a currency mark someone typed or pasted in front of an amount. */
export const LEADING_CURRENCY_MARK =
  /^(₦|\$|£|€|GH₵|NGN|USD|GBP|EUR|GHS|KES|KSh)\s*/i;
