import { useContext } from 'react';
import { AuthContext, type AuthState, type OrgRole } from './AuthProvider';

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}

/**
 * Who may see what the goods cost, mirroring `SEES_COST` on the server.
 *
 * **This hides things; it does not protect them.** The server redacts cost
 * fields for every other role and refuses the cost-bearing routes outright
 * (DECISIONS.md §9). This exists so a rep is not shown a column that will
 * always read as absent — never as the control itself.
 */
export const SEES_COST: readonly OrgRole[] = ['owner', 'manager', 'accountant'];

export function useSeesCost(): boolean {
  const { user } = useAuth();
  return user !== null && SEES_COST.includes(user.orgRole);
}

/**
 * Where a role's day starts.
 *
 * **Hiding a nav item does not decide where somebody lands.** `Layout` marks
 * Home `costOnly` and hides it from a rep, which is right — `GET
 * /reports/dashboard` is closed to anyone outside {@link SEES_COST}. But three
 * separate paths send people to `/` regardless of role: signing in with no
 * intended destination, a role-guarded route turning somebody away, and a URL
 * that matches nothing. All three used to land a rep on the one screen that
 * fires the one request they may not make, so the first thing they saw after
 * signing in was a red error box with no way back except guessing at the nav.
 *
 * So the landing path is a fact about the role, stated once, and every one of
 * those three paths asks for it rather than assuming `/`.
 *
 * A rep starts at the till and a storekeeper at stock, because those are the
 * screens each of them opens the app to use. An accountant sees cost, so the
 * dashboard is genuinely their morning.
 */
export function landingPath(role: OrgRole | undefined): string {
  if (role === undefined || SEES_COST.includes(role)) return '/';
  return role === 'storekeeper' ? '/stock' : '/till';
}

export function useLandingPath(): string {
  const { user } = useAuth();
  return landingPath(user?.orgRole);
}

/** Convenience for the many screens that are owner-and-manager only. */
export function useIsManager(): boolean {
  const { user } = useAuth();
  return user?.orgRole === 'owner' || user?.orgRole === 'manager';
}

/**
 * Who records stock moving, mirroring `STOCK_RECORDERS` on the server.
 *
 * Everybody except the accountant: receiving a delivery, writing off breakage
 * and moving stock to a van are all daily work rather than decisions. The two
 * things that *are* decisions — forcing a movement through a shortfall, and
 * posting a count — stay with {@link useIsManager}.
 *
 * Navigation, not security. The server refuses these routes regardless (§9).
 */
export const RECORDS_STOCK: readonly OrgRole[] = [
  'owner',
  'manager',
  'storekeeper',
  'sales_rep',
];

export function useRecordsStock(): boolean {
  const { user } = useAuth();
  return user !== null && RECORDS_STOCK.includes(user.orgRole);
}
