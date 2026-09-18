import { OrgRole } from '@prisma/client';
import { TenantContext } from '../tenancy/tenant-context';

/**
 * Who may see what the business paid for its goods.
 *
 * Buying prices are the one figure a rep must not have. They are what the
 * business negotiated with its vendor, they are the whole of the margin on a
 * 2–3% product, and a rep who knows them can price against the house or carry
 * them to a competitor.
 *
 * This list was previously spelled out only in `report.controller.ts`, which is
 * why it held on `GET /reports/profit` and nowhere else: the same numbers were
 * reachable through `GET /products` (`costPrice`), `GET /sales` (per-line
 * `costOfGoodsSold`) and `GET /stock/levels?includeBatches=true` (per-lot cost)
 * with no role check at all. One exported constant now, so the next report to
 * be written cannot quietly disagree with this one.
 */
export const SEES_COST: OrgRole[] = [
  OrgRole.owner,
  OrgRole.manager,
  OrgRole.accountant,
];

/**
 * Whether the caller of the current request may see cost.
 *
 * Reads the role from the tenant store rather than taking it as an argument, so
 * a service deep in a read path can ask without every signature above it
 * growing a parameter. Outside a request — a cron, a unit test — there is no
 * role and the answer is no, which is the safe direction.
 */
export function callerSeesCost(): boolean {
  const orgRole = TenantContext.get()?.orgRole;
  return Boolean(orgRole && SEES_COST.includes(orgRole));
}

/**
 * Removes cost-bearing fields from a row unless the caller may see them.
 *
 * Applied in the *read* methods — `findAll`, `findOne` — and deliberately not
 * in the shared `include` those methods pass to Prisma. Internal callers need
 * the real numbers: `SaleReturnService` reads `costOfGoodsSold` to work out how
 * much cost comes back with returned goods, and it would silently compute NaN
 * against a redacted row. Those callers run their own queries, so redacting at
 * the presentation edge leaves them untouched.
 *
 * The return type says the fields are optional rather than gone, which is what
 * is actually true: present for an owner, absent for a rep.
 */
export function redactCost<T extends object, K extends keyof T>(
  row: T,
  fields: readonly K[],
): Omit<T, K> & Partial<Pick<T, K>> {
  if (callerSeesCost()) return row;

  const visible: Partial<T> = { ...row };
  for (const field of fields) delete visible[field];
  return visible as Omit<T, K> & Partial<Pick<T, K>>;
}

/** `redactCost` over a list. */
export function redactCostAll<T extends object, K extends keyof T>(
  rows: T[],
  fields: readonly K[],
): (Omit<T, K> & Partial<Pick<T, K>>)[] {
  if (callerSeesCost()) return rows;
  return rows.map((row) => redactCost(row, fields));
}
