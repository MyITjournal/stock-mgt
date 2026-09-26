import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useSeesCost } from '../auth/useAuth';
import { Button } from './Button';

interface NavItem {
  to: string;
  label: string;
  /** Hidden when the signed-in role would only get a 403 or an empty screen. */
  costOnly?: boolean;
}

const NAV: readonly NavItem[] = [
  { to: '/', label: 'Home', costOnly: true },
  { to: '/till', label: 'Till' },
  { to: '/sales', label: 'Sales' },
  { to: '/customers', label: 'Customers' },
  { to: '/money', label: 'Money', costOnly: true },
  { to: '/stock', label: 'Stock' },
  { to: '/reports', label: 'Reports', costOnly: true },
  { to: '/settings', label: 'Settings' },
];

/**
 * The frame every signed-in screen sits in.
 *
 * Navigation hides what a role cannot use — `GET /reports/dashboard` is owner,
 * manager and accountant only, so "Home" would be a 403 for anyone else. That
 * is a courtesy, not a control: the server refuses those routes whatever this
 * renders (DECISIONS.md §9).
 */
export function Layout() {
  const { user, signOut } = useAuth();
  const seesCost = useSeesCost();

  const items = NAV.filter((item) => !item.costOnly || seesCost);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
          <span className="text-sm font-semibold text-slate-900">stock-mgt</span>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm transition ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">
              {user?.email ?? 'signed in'} · {user?.orgRole.replace('_', ' ')}
            </span>
            <Button variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

export function Page({
  title,
  description,
  actions,
  back,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /**
   * Where this screen was opened from.
   *
   * **Any screen you navigate *into* needs one.** The top navigation and the
   * tab strips only reach list screens, so a detail page reached by clicking
   * a row was a dead end: the only way out of an invoice was to press "Sales"
   * again, which throws away the filters and the place in the list that got
   * you there.
   */
  back?: { to: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <>
      {back && <BackLink {...back} />}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          )}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
      {children}
    </>
  );
}

/**
 * Out of here, and back to where you came from.
 *
 * Steps back through history when there is history to step through, so the
 * list you came from is still filtered and scrolled the way you left it.
 * Falling back to `to` matters more than it looks: a link pasted into
 * WhatsApp, or a page opened in a new tab, has nothing behind it, and
 * `navigate(-1)` from there walks out of the application entirely.
 *
 * `location.key` is `'default'` exactly when this is the first entry the
 * router has seen, which is the test for that case.
 */
function BackLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  const location = useLocation();

  // `'default'` is exactly the case where this is the first entry the router
  // has seen — a pasted link, or a new tab — and there is nothing to step
  // back to.
  const deepLinked = location.key === 'default';

  return (
    <button
      type="button"
      onClick={() => (deepLinked ? navigate(to) : navigate(-1))}
      className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-slate-900"
    >
      {/*
        Named only when we know where it goes. Stepping back lands wherever
        you came from, which is usually the list this belongs to but not
        always — a customer can be reached from the movers report as well as
        from Customers — and a label that names the wrong screen is worse
        than one that names none.
      */}
      <span aria-hidden="true">←</span> {deepLinked ? label : 'Back'}
    </button>
  );
}
