import { Link } from 'react-router-dom';

/**
 * The only screen whose job is to persuade rather than to serve.
 *
 * ## Why it exists
 *
 * Until sign-up opened, everybody reaching this address already knew what it
 * was. Now a stranger can create a shop — and a stranger who arrives at a
 * password box with no explanation leaves. This is the screen that decides
 * whether anybody bothers.
 *
 * ## What it leads with
 *
 * The debts, in the words a shop owner has actually heard. The first headline
 * was "Stop running your shop out of a notebook", which every entrant in this
 * market uses — Better Tailor almost verbatim (MARKET.md §1). Nobody claims
 * customer credit, and it is the deepest thing here: allocations, void versus
 * refund, and a balance that holds the next credit sale. "I'll pay you on
 * Friday" is a sentence every shop owner has been told; "Which Friday?" is the
 * one they did not get to say.
 *
 * The card under it shows rather than tells — longest-owed first, because that
 * is how `GET /receivables` sorts and the question people actually ask (§5).
 * Its names and amounts are invented; keep them plainly illustrative.
 *
 * ## What it deliberately does not do
 *
 * No waitlist, no "request a demo", no email capture. The product works today
 * and the button creates a shop in thirty seconds — putting a form in front of
 * that would throw away the only advantage it has over everyone still building.
 *
 * Nothing here is behind authentication, so it must not import anything that
 * assumes a session.
 *
 * ## Signed in
 *
 * The dashboard's wordmark opens this page at `/about` (2026-10-09), so a
 * signed-in person reads it too. They get `startPath` — their own start
 * screen, from `landingPath` — and every sign-in or sign-up button becomes
 * **Open my shop**, since those pages would only send them back anyway.
 */
export function LandingPage({ startPath }: { startPath?: string } = {}) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight text-brand-700">
          Reho
        </span>
        <nav className="flex items-center gap-2">
          {startPath ? (
            <Link
              to={startPath}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
            >
              Open my shop
            </Link>
          ) : (
            <>
              <Link
                to="/sign-in"
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900"
              >
                Sign in
              </Link>
              <Link
                to="/sign-up"
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
              >
                Create your shop
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* -- The pitch ------------------------------------------------------ */}
      <section className="mx-auto max-w-3xl px-6 pb-16 pt-12 text-center sm:pt-20">
        <h1 className="tracking-tight">
          <span className="block text-2xl font-medium italic text-slate-500 sm:text-3xl">
            “I’ll pay you on Friday.”
          </span>
          <span className="mt-3 block text-5xl font-semibold leading-tight text-brand-700 sm:text-7xl">
            Which Friday?
          </span>
        </h1>
        <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-slate-600">
          Reho remembers every debt — who, how much, which invoice, and since
          when. Oldest first, so you know who to call today. Your sales and your
          stock live in the same place.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          {startPath ? (
            <Link
              to={startPath}
              className="w-full rounded-md bg-brand-600 px-6 py-3 text-base font-medium text-white transition hover:bg-brand-700 sm:w-auto"
            >
              Open my shop
            </Link>
          ) : (
            <>
              <Link
                to="/sign-up"
                className="w-full rounded-md bg-brand-600 px-6 py-3 text-base font-medium text-white transition hover:bg-brand-700 sm:w-auto"
              >
                Create your shop — free
              </Link>
              <Link
                to="/sign-in"
                className="w-full rounded-md border border-slate-300 px-6 py-3 text-base font-medium text-slate-700 transition hover:bg-slate-50 sm:w-auto"
              >
                I already have one
              </Link>
            </>
          )}
        </div>

        {/*
          Said here because it is the objection that stops people: every other
          tool wants an email, a verification code and a card before it shows
          them anything. Somebody already in has no use for it.
        */}
        {!startPath && (
          <p className="mt-4 text-sm text-slate-500">
            No card, no email needed. You will be using it in under a minute.
          </p>
        )}

        <OwedCard />
      </section>

      {/* -- What it actually does ------------------------------------------ */}
      <section className="border-y border-slate-200 bg-brand-50/60">
        <div className="mx-auto grid max-w-5xl gap-8 px-6 py-14 sm:grid-cols-3">
          <Feature
            title="Chase what you are owed"
            body="Who owes you, longest first. Record payments against the invoices they settle, print a statement, and hold the next credit sale until the last one is paid."
          />
          <Feature
            title="Sell at the counter"
            body="Scan or search, pick the unit, take cash or transfer. Prices come from your own price list, so a carton never gets charged as twelve pieces."
          />
          <Feature
            title="Know what you have"
            body="Every delivery, sale and breakage is recorded. See what is low before it runs out, and what expires before it does."
          />
        </div>
      </section>

      {/* -- Who it is for -------------------------------------------------- */}
      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Built for shops that sell fast and count carefully
        </h2>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          Provisions, drinks, cosmetics, building materials — anywhere margins
          are thin enough that a carton sold at the wrong price matters. Works
          on the shop computer and on a phone at the counter.
        </p>
        <Link
          to={startPath ?? '/sign-up'}
          className="mt-8 inline-block rounded-md bg-brand-600 px-6 py-3 text-base font-medium text-white transition hover:bg-brand-700"
        >
          {startPath ? 'Open my shop' : 'Create your shop'}
        </Link>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 py-8 text-sm text-slate-500 sm:flex-row">
          <span>Reho — sales and stock for your shop.</span>
          <Link to={startPath ?? '/sign-in'} className="hover:text-slate-800">
            {startPath ? 'Open my shop' : 'Sign in'}
          </Link>
        </div>
      </footer>
    </div>
  );
}

/** Invented customers, shaped like the real receivables screen. */
const OWED = [
  { name: 'Mama Chidi Provisions', invoices: 3, amount: '₦184,500', days: 41 },
  { name: 'Emeka & Sons', invoices: 1, amount: '₦62,000', days: 19 },
  { name: 'Alhaja Kudi', invoices: 2, amount: '₦27,250', days: 6 },
];

function OwedCard() {
  return (
    <div
      className="mx-auto mt-14 max-w-md rounded-xl border border-slate-200 bg-white text-left shadow-sm"
      aria-label="Example: who owes you"
    >
      <div className="flex items-baseline justify-between border-b border-slate-100 px-5 py-3">
        <span className="text-sm font-semibold text-slate-900">Who owes you</span>
        <span className="text-xs text-slate-500">longest first</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {OWED.map((row, index) => (
          <li key={row.name} className="flex items-center justify-between gap-4 px-5 py-3">
            <div>
              <div className="text-sm font-medium text-slate-900">{row.name}</div>
              <div className="text-xs text-slate-500">
                {row.invoices} {row.invoices === 1 ? 'invoice' : 'invoices'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold tabular-nums text-slate-900">
                {row.amount}
              </div>
              <div
                className={`text-xs ${index === 0 ? 'font-medium text-accent-700' : 'text-slate-500'}`}
              >
                {row.days} days
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t border-slate-100 bg-brand-50/60 px-5 py-3 text-xs text-brand-800">
        Mama Chidi’s next credit sale waits until this is settled — unless you
        say otherwise.
      </p>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-brand-800">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
    </div>
  );
}
