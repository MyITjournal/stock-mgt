import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/settings', label: 'Business', end: true },
  { to: '/settings/hours', label: 'Opening hours' },
  { to: '/settings/staff', label: 'Staff' },
];

/**
 * The settings section.
 *
 * Three screens, and the split follows who changes what and how often: the
 * letterhead is set once and printed on every document, the hours gate signing
 * in, and staff is the only place that mints credentials.
 *
 * Reading is open to every member — a rep issuing an invoice needs the details
 * that go on it — but writing is owner or manager, and staff writes are owner
 * only. The server enforces all of it (DECISIONS.md §9).
 */
export function SettingsLayout() {
  return (
    <>
      <nav className="mb-6 flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => (
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
