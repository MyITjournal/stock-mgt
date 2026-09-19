import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import type { OrgRole } from './AuthProvider';

/**
 * Keeps a route behind a session, and optionally behind a role.
 *
 * **The role check here is navigation, not security.** Every rule it mirrors is
 * enforced on the server, which answers 403 regardless of what this does. Its
 * job is to avoid showing somebody a page that will only ever fail — routing
 * them somewhere useful instead of into an error they cannot act on.
 */
export function RequireAuth({ roles }: { roles?: readonly OrgRole[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Waiting on the first `GET /auth/me`. Redirecting now would bounce a signed
  // in person to the login screen on every hard refresh.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  if (!user) {
    // `state.from` so signing in returns to where they were headed.
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }

  if (roles && !roles.includes(user.orgRole)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" role="status" aria-live="polite">
      <span className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
