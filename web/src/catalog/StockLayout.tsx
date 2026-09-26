import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/stock', label: 'Products', end: true },
  { to: '/stock/levels', label: 'On hand' },
  { to: '/stock/receipts', label: 'Deliveries' },
  { to: '/stock/movements', label: 'Movements' },
  { to: '/stock/counts', label: 'Counts' },
  { to: '/stock/places', label: 'Places & vendors' },
  { to: '/stock/setup', label: 'Categories & tiers' },
];

/**
 * The stock section.
 *
 * Two halves, in the order somebody works: the catalog (what the business
 * sells, how it is packaged and priced), then the ledger (what is on the
 * shelf, what arrived, what moved, and what a count found).
 *
 * "Products" is the catalog; everything from "On hand" rightwards reads or
 * writes the append-only ledger.
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
