# stock-mgt (product name: Reho)

Sales and inventory for FMCG businesses, sold as a subscription. Deliberately **not**
accounting — no chart of accounts, no double-entry. NestJS + Prisma + PostgreSQL, with a
Vite + React dashboard in `web/`.

## Read this first

**[docs/DECISIONS.md](docs/DECISIONS.md)** holds every decision, its rationale, what was rejected,
and the traps already hit. **§23 is the archive of per-feature notes** that used to live here —
search it (`grep`) for the area you are about to change before planning anything.

## Non-negotiable invariants

These are load-bearing. Breaking one is a data-integrity bug, not a style choice.

- **Money is an integer count of kobo.** Never a float, never a decimal string. Prices are stored
  **tax-inclusive**; VAT is derived by subtraction, never stored.
- **Cost is stored as exact totals, never as a rounded per-unit average.** Unit cost is a ratio,
  computed on read. Receiving takes the *invoice total* and the quantity received.
- **Stock is recorded in base units** — the one unit per product with `factor = 1`.
- **Stock is an append-only ledger.** Never a mutable `quantity` column.
- **Every tenant-owned table carries `organizationId`** and must be registered in
  `TENANT_SCOPED_MODELS` in `src/common/tenancy/tenant.prisma.ts`. A test derives the expected
  list from the Prisma DMMF and fails until you do.
- **Writes accept a client-supplied id and an `Idempotency-Key`.** The mobile app works offline.

## Rules that are easy to break

One line each; the reasoning is in DECISIONS.md.

**Money and cost**
- Revenue is **tax-exclusive** (unless `Organization.chargesVat` is off); every money figure on a
  sale is a snapshot. One currency per shop, locked once money is recorded.
- Value stock from **lot totals, rounded once** — never `Product.costPrice` or `costPrice × factor`.
- Anything revealing what goods cost goes through `SEES_COST` / `redactCost`
  (`common/authz/cost-visibility.ts`): redact at the read edge, header and lines together, and
  **remove** the field — never zero it.
- Balances: `saleBalance` + `LIVE_ALLOCATIONS` (customers); `billBalance` with the required
  `CREDITED_REBATES` (vendors). **A supplier payment is never an `Expense`.**
- Server messages naming an amount use `shopMoney`; the browser renders money through `<Money>`
  and computes none (the till's running total is the one exception).

**Stock**
- Every movement carries a batch; quantity is signed. Selling goes through
  `StockService.recordOutbound` — never write the ledger from elsewhere.
- Opening stock is an **opening balance, never a delivery** (no bill). A recorded delivery is
  **corrected, never edited**. Quantities are whole base units; a decimal like 6.25 cartons is
  allowed only in forms and must convert whole (`toWholeBaseUnits`).
- Units, prices and barcodes on a product **upsert and never delete** what a request omits; no
  base price means no fallback price.

**Time and feeds**
- All date arithmetic lives in `reports/period.ts`, in `Organization.timezone`, never UTC.
  Growth compares a month so far with **the same days of last month** (`sameSpanLastMonth`).
- Append-only feeds sync on `createdAt`, mutable ones on `updatedAt`; any list a person browses
  needs `order=desc` as well as the sync default.
- The host sleeps (free tier): **no scheduled job may rely on a time of day.**

**Security and roles**
- **Select, never exclude**: `PUBLIC_USER_SELECT` is an allow-list. `forbidNonWhitelisted` on the
  global pipe is a security control. `JwtAuthGuard` must stay registered before the throttler.
- Every path that mints a session checks working hours and `signsInOnOneDevice`
  (`issueForUser`, `switchOrganization`; `rotate` checks hours). End sessions with
  `TokenService.endSessions` — it is immediate — never bare `revokeAllForUser`.
- **Staff (`sales_rep`, `storekeeper`) sell, take payments, record deliveries and count.**
  Returns, adjustments, transfers, products, prices, settings: owner/manager. New writes default
  to owner/manager. UI role checks are navigation, not security — and hiding a nav item does not
  decide where somebody lands (`landingPath`).
- `OTP_OVERRIDE` is test-instance-only. Never run `npm audit fix --force`.

**Writes and refusals**
- Across a retry the stable thing is the **`id`**, not the `Idempotency-Key` (each attempt gets a
  fresh key).
- A 409 is a rule: for stock and credit, **supplying the reason is the override**
  (owner/manager). `POSSIBLE_DUPLICATE` is a warning anyone passes with `allowDuplicate`. A test
  expecting a 409 must check *which* one.

## Hosting

Render **free** tier, **one** web service that also serves the dashboard (cookies are
`sameSite: lax` and `onrender.com` is a public suffix — never split it), `VITE_API_URL=/api/v1`.
Database on Supabase through the **session-mode pooler** (port 5432), one URL for runtime and
migrations; pool size is `DATABASE_POOL_MAX`. No shell on Render: run `dist/cli/admin` from a
laptop. Deploy runs `prisma migrate deploy`. Details: DECISIONS.md §21.

## The web dashboard (`web/`)

Its own `package.json`; `npm run dev` inside `web/` serves **5173** (the URL to open) while the
API runs on 4000.
- **Types are generated**: `npm run api:types` after any endpoint or DTO change. Every endpoint a
  screen reads needs a response class that **is** the service's declared return type.
- Every request goes through `src/api/client.ts` (cookies, one shared refresh, idempotency keys);
  PDFs through `api.document`. Every write ends with `afterWrite`.
- A cost field may be **absent**, not null. Seed forms by mounting with data, never `useEffect`.
  Inputs never rewrite what is being typed. A passed `className` must be able to override width.

## Where things stand

v1 is feature-complete and hosted; work now is fixes and owner requests, one branch each.
Latest (2026-10-08): who is signed in and sign-out, growth, the duplicate-sale warning, opening
stock on Add product. **Next: cash banking** — the plan and the owner's choices are in the
`build-queue-2026-10-08` memory. v2 is scoped in [docs/PRD-V2.md](docs/PRD-V2.md). The by-hand
browser script is [docs/MANUAL-TESTS-WEB.md](docs/MANUAL-TESTS-WEB.md).

## Working practice

- `main` (release, tagged) → `dev` (integration) → short-lived feature branches merged `--no-ff`.
  Never commit to `main`. The owner runs every commit.
- Plan → get approval → build, one slice at a time.
- A branch is done when `npm run typecheck`, `npm run lint`, `npx jest` and `npm run build` are
  all clean **and** `npm run smoke` passes against a running server.
- **Docs, briefly, in the same branch**: a line here only if it is a rule future work must not
  break; a short section in DECISIONS.md for the decision and any trap hit; a few steps in
  MANUAL-TESTS-WEB.md. Keep this file short — it is loaded into every conversation.
- **Never edit a doc with PowerShell `Get-Content -Raw` / `Set-Content`** — PS 5.1 mangles UTF-8
  (`—`, `₦`). Use the editing tools.

## Commands

```bash
npm run start:dev     # watch mode; Swagger at http://localhost:4000/docs
                      # routes are under /api/v1 (API_PREFIX); Swagger is not
npm run typecheck
npm run lint
npx jest
npm run build
npm run db:studio

npm run smoke          # end-to-end against a running server; see below

# Creating and recovering accounts on an instance with SELF_SERVE_SIGNUP=false.
# Needs a build first; the password is always prompted for, never a flag.
node dist/cli/admin create-org --org "Adebayo Stores" \
  --first Ade --last Bayo --email owner@example.com
node dist/cli/admin set-password --email owner@example.com
```

`npm run smoke` reads the OTP from the server's log:

```bash
npm run start:dev > server.log 2>&1        # terminal 1
SMOKE_SERVER_LOG=server.log npm run smoke  # terminal 2, unattended
```

Smoke's load-bearing check is that stock movements sum to stock levels. Running it twice inside a
minute fails with a 429 on login (the rate limiter working). `npm run build` while the watch
server runs restarts it — wait for it before running smoke.

Migrations: `prisma migrate dev` is interactive and fails here. Use
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
into a new folder under `prisma/migrations/`, then `npx prisma migrate deploy`.

Check port 4000 is free before starting the server: a leftover watch server lets a new one map
its routes and then die on `EADDRINUSE`, leaving old code answering.
