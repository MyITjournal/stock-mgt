import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/till', label: 'Till' },
  { to: '/sales', label: 'History' },
  // Everybody's own cash, banked or not (2026-10-08). Here rather than under
  // Money because a cashier works here and cannot open Money.
  { to: '/my-cash', label: 'My cash' },
];

/**
 * The sales section: ringing a sale up, and the sales already made
 * (2026-10-06, owner: the till "could be with the sale").
 *
 * They were two items on the top bar. One is where a sale is made and the
 * other where it is looked up afterwards, so they sit under one name as two
 * tabs. **The addresses did not change** — the till is still `/till`, which is
 * where a cashier lands (`landingPath`), and saved links to `/sales` work.
 */
export function SalesLayout() {
  return (
    <>
      <nav className="mb-6 flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end
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
