import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/stock', label: 'Products', end: true },
  { to: '/stock/setup', label: 'Categories & tiers' },
];

/**
 * The stock section.
 *
 * Slice 7.5a fills in the catalog half — what the business sells, and how it is
 * packaged and priced. 7.5b adds the movement half: levels, deliveries,
 * adjustments, transfers and stocktake, as further tabs here.
 */
export function StockLayout() {
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
