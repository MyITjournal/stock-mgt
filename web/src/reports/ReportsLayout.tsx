import { NavLink, Outlet, useSearchParams } from 'react-router-dom';

const TABS = [
  { to: '/reports', label: 'Profit', end: true },
  { to: '/reports/sales', label: 'Sales' },
  { to: '/reports/purchases', label: 'Purchases' },
  { to: '/reports/collections', label: 'Money in' },
  { to: '/reports/stock', label: 'Stock' },
  { to: '/reports/movers', label: 'Movers' },
  { to: '/reports/targets', label: 'Targets' },
];

/**
 * The reports section.
 *
 * Every tab reads the same window, which lives in the URL — so switching from
 * profit to sales keeps the month you were looking at, and a link to a
 * particular report over a particular period is a link somebody can send.
 *
 * All of this is cost-bearing except the sales slice, which is redacted rather
 * than closed. The nav item above is already hidden from a `sales_rep`, and the
 * server refuses the routes regardless (DECISIONS.md §9).
 */
export function ReportsLayout() {
  const [params] = useSearchParams();
  const window = params.toString();

  return (
    <>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={window ? `${tab.to}?${window}` : tab.to}
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
