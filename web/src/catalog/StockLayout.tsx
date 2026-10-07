import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useIsManager } from '../auth/useAuth';

const TABS = [
  { to: '/stock', label: 'Products', end: true, managers: false },
  { to: '/stock/levels', label: 'On hand', managers: false },
  { to: '/stock/receipts', label: 'Deliveries', managers: false },
  { to: '/stock/movements', label: 'Movements', managers: false },
  { to: '/stock/counts', label: 'Counts', managers: false },
  { to: '/stock/places', label: 'Places & vendors', managers: true },
  { to: '/stock/setup', label: 'Categories & tiers', managers: true },
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
 *
 * **Staff see the stock, take deliveries and count** (owner, 2026-10-07) —
 * they do not adjust or move it, edit or retire products, or set prices, and
 * the set-up tabs (places and vendors, categories and price lists) are left
 * out for them. A link into one lands on Products.
 */
export function StockLayout() {
  const isManager = useIsManager();
  const { pathname } = useLocation();
  const managersOnly = TABS.some(
    (tab) => tab.managers && pathname.startsWith(tab.to),
  );
  if (!isManager && managersOnly) return <Navigate to="/stock" replace />;
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
