import { NavLink, Outlet } from 'react-router-dom';
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
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
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
