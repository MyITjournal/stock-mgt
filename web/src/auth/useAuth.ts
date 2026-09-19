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

/** Convenience for the many screens that are owner-and-manager only. */
export function useIsManager(): boolean {
  const { user } = useAuth();
  return user?.orgRole === 'owner' || user?.orgRole === 'manager';
}
