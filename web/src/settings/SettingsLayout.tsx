import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useIsManager } from '../auth/useAuth';

const PASSWORD = '/settings/password';

const TABS = [
  { to: '/settings', label: 'Business', end: true, managers: true },
  { to: '/settings/hours', label: 'Opening hours', managers: true },
  { to: '/settings/staff', label: 'Staff', managers: true },
  { to: PASSWORD, label: 'Your password', managers: false },
];

/**
 * The settings section.
 *
 * Four screens, and the split follows who changes what and how often: the
 * letterhead is set once and printed on every document, the hours gate signing
 * in, and staff is the only place that mints credentials.
 *
 * Your password is the odd one out and deliberately sits here anyway: it is the
 * only settings screen a cashier has business on, because everybody has a
 * password. On the hosted instance it is also the *only* way anybody changes
 * one, since self-serve reset is off (DECISIONS.md §20).
 *
 * **Staff see only their own password** (owner, 2026-10-07: "the settings
 * should largely be kept hidden"). The business details, opening hours and the
 * staff list are an owner's or manager's; anyone else who opens Settings — or
 * a link into it — lands on *Your password*. Navigation, not security: the
 * server enforces every write (DECISIONS.md §9).
 */
export function SettingsLayout() {
  const isManager = useIsManager();
  const { pathname } = useLocation();
  if (!isManager && pathname !== PASSWORD) {
    return <Navigate to={PASSWORD} replace />;
  }
  const tabs = TABS.filter((tab) => isManager || !tab.managers);

  return (
    <>
      <nav className="mb-6 flex gap-1 border-b border-slate-200">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm transition ${
                isActive
                  ? 'border-slate-900 font-medium text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
