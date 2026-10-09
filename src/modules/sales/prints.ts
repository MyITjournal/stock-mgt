import { OrgRole } from '@prisma/client';
import { TenantContext } from '../../common/tenancy/tenant-context';

/**
 * How many copies of an invoice the shop has produced, and who made each
 * (2026-10-09, owner).
 *
 * A reprint is how a receipt gets used twice — handed to a second person to
 * collect goods, or kept to cover money that was never paid in — so the count
 * is a check on staff, and **staff do not see it**. They see only what is
 * printed on the paper itself: "COPY 2" on everything after the first.
 * Owners and managers see the count on every sale and, on the sale's own page,
 * who made each copy and when.
 *
 * Like cost (§9), the fields are **removed**, never zeroed, for anyone else: a
 * zero would read as "never printed", which is a claim, not a redaction.
 */
export const SEES_PRINTS: OrgRole[] = [OrgRole.owner, OrgRole.manager];

export function callerSeesPrints(): boolean {
  const orgRole = TenantContext.get()?.orgRole;
  return Boolean(orgRole && SEES_PRINTS.includes(orgRole));
}

/** Every sale read carries its count; cheap, so the list can show it. */
export const PRINT_COUNT = { _count: { select: { prints: true } } } as const;

/** The copies themselves, oldest first — on the sale's own page only. */
export const PRINT_HISTORY = {
  prints: {
    orderBy: { copy: 'asc' },
    select: {
      copy: true,
      kind: true,
      createdAt: true,
      printedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const;

/**
 * Turns the raw count (and history, where it was read) into `printCount` and
 * `prints` for an owner or manager, and removes both for anyone else.
 *
 * `_count` is optional because a row read without `PRINT_COUNT` — a test's
 * stand-in, say — has none, and that is the same as having nothing to show.
 */
export function withPrints<
  T extends { _count?: { prints: number }; prints?: readonly unknown[] },
>(row: T) {
  const { _count, prints, ...rest } = row;
  if (!callerSeesPrints()) return rest;
  return {
    ...rest,
    printCount: _count?.prints ?? 0,
    ...(prints && { prints }),
  };
}
