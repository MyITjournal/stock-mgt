import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/money', label: 'Owed to us', end: true },
  { to: '/money/payments', label: 'Payments' },
  { to: '/money/accounts', label: 'Accounts' },
];

/**
 * The money section.
 *
 * Expenses and bank accounts live here rather than under Settings, because
 * both are daily money work: an expense is recorded by whoever spent, and an
 * account is picked every time somebody takes a transfer. Settings keeps the
 * things set up once — letterhead, staff, working hours.
 */
export function MoneyLayout() {
  return (
    <>
      <nav className="mb-6 flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-4 py-2 text-sm transition ${
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
