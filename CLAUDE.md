# stock-mgt

Sales and inventory for FMCG businesses, sold as a subscription. Deliberately **not**
accounting — no chart of accounts, no double-entry. NestJS + Prisma + PostgreSQL.

## Read this first

**[docs/DECISIONS.md](docs/DECISIONS.md)** holds every architecture decision, its rationale, what
was rejected, and the traps already hit. Read it before planning or changing anything
structural — the reasoning there is expensive to reconstruct and not visible in the code.

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

## Where things stand

**Slices 0–6.6 are done, plus a 6.1 gap-closing pass**: rails, tenancy + auth, catalog (products,
units, tier pricing, barcodes, money in kobo), write idempotency, packaging types, the inventory
ledger — `StockMovement`
(append-only), locations, suppliers, batches with expiry, receiving, FEFO picking, adjustments
and transfers, delta-sync cursors — sales: invoices with lines, tier pricing, cost of goods
sold, and returns — money in: payments with allocations, receivables, customer statements and
expenses — and reports: a dashboard, profit, sales slices, stock valuation, expiry, movers and
reorder alerts — plus stocktake, product images, a cash-up, and the no-credit rule.

**Prices and barcodes are set on the product itself** (§4), in the `prices` and `barcodes` arrays
on `POST /products` and `PATCH /products/:id`, keyed by **unit name** — the units are created by
the same request, so there are no ids to point at yet. `POST /products/:id/prices` is gone;
`POST /products/:id/barcodes` stays, because attaching a code to a product that already exists is
a separate act. **Both arrays upsert and never delete what they do not list**: replace-all would
let a PATCH naming one unit wipe the prices of the rest. Without a tier row a unit falls back to
`basePrice × factor`, which is right for a sachet and wrong for a carton — that fallback silently
overcharging a walk-in is the bug this shape exists to prevent.

Two Slice 3 rules worth knowing before you touch stock: **every movement carries a batch** and
**quantity is signed** (positive in, negative out). And the negative-stock policy — the ledger
records everything, while the *write path* refuses an outbound movement it cannot cover with a
409, unless an owner or manager forces it with a reason.

Two Slice 4 rules worth the same: **selling never writes to the ledger itself** — it calls
`StockService.recordOutbound`, so FEFO, the 409 and the override are inherited rather than
reimplemented — and **every money figure on a sale is a snapshot**, including cost of goods sold,
which is rounded exactly once from the batches the pick actually took.

**Purchasing was cut, not deferred.** Purchase orders are not raised in this market; orders go by
phone and are recorded as a goods receipt on arrival. Do not reintroduce it in a smaller hat — an
"expected delivery", a draft receipt — see [docs/DECISIONS.md](docs/DECISIONS.md) §6. The monthly
vendor purchase targets survived and moved to the reports slice.

Two Slice 5 rules to add to those: **a payment is one row per thing that happened** — a single
transfer settling three invoices is one `Payment` with three `PaymentAllocation` rows, so it
still reconciles against a bank statement — and **the amount is signed**, positive in and negative
back out, so a refund is an ordinary payment row rather than a second table. Which invoice a
payment answered is recorded, never inferred: allocations are validated, not spread cleverly, and
`allocateOldest` runs only when the caller supplied none. Money left over stays as credit on the
customer; over-allocating a single invoice is a 409. `Sale.amountPaid` is **gone** — a counter
sale writes its own payment row inside the sale transaction, so recording a sale is still one
request.

Receivables is deliberately **a list sorted oldest-first, not 30/60/90 buckets** — the question
people ask is who has owed longest, which is a sort. Buckets can be added the day someone asks to
read them.

**Correcting a mistake is a void; correcting reality is a negative payment.** A void
(`POST /payments/:id/void`, owner/manager/accountant only, reason required) says the money never
moved — a mis-key, the wrong customer. A negative payment says money moved back — a refund, a
bounced cheque. Voiding keeps the row and its allocations and stops it counting, so the invoice
goes back to owed. What counts toward a balance is defined once in
`src/modules/payments/balance.ts`: `saleBalance` for the arithmetic, `LIVE_ALLOCATIONS` for the
query filter. **Use `LIVE_ALLOCATIONS` in any new query that feeds a balance** — that is the one
place this is easy to get wrong.

Slice 6 added **reports**, in `src/modules/reports/` — a read-only module with three pure cores:
`period.ts`, `profit.ts`, `valuation.ts`. Four rules from it are load-bearing:

- **Revenue is tax-exclusive.** Prices are VAT-inclusive, so counting the gross overstates every
  margin by 7.5%. The dashboard reads lower than expected; that is it working.
- **Periods resolve in `Organization.timezone`**, never UTC — otherwise "today" rolls over at 1am
  Lagos time. All of it lives in `period.ts`; nothing else does date arithmetic.
- **A return counts in the period it happened**, not the month of the sale it reverses.
- **Stock is valued from lot totals, rounded once** — never `Product.costPrice`, which §2 forbids
  as an input.

`GET /reports/dashboard` is deliberately one call, and cost-bearing reports (profit, valuation,
margins) are closed to `sales_rep`.

**Slice 6.1 closed five recorded gaps.** Four of its rules are load-bearing:

- **Append-only feeds sync on `createdAt`; mutable ones sync on `updatedAt`** (§8). Payments and
  expenses are mutable — a void or a delete must reach a client that already synced the row — so
  they use `keysetWhereUpdated`. Clients upsert by id, because that ordering can re-send a row.
  Pick the right helper deliberately for every new feed; getting it wrong fails silently.
- **There is no credit limit** (§6). The product does not extend credit as a matter of course, so
  an unsettled balance *gates* the next credit sale with a 409. An owner or manager overrides by
  supplying `creditOverrideReason`, which is stored on the sale — supplying the reason is the
  override, so one can never be recorded without one.
- **Counting is not adjusting** (§5). A stocktake is recorded by whoever counts and **posted** by
  an owner or manager; until posted it changes no stock. Posting recomputes variance against live
  stock and writes `count_correction` adjustments — shortfalls FEFO out, surpluses land on the
  newest batch at that location, because every movement carries a batch.
- **`Payment.locationId`** is set automatically by a counter sale, and `GET /reports/collections`
  groups on it: that is the end-of-shift cash-up (§11).
- **Goods sold before their delivery is recorded are costed from the last real lot, never at
  zero** (§2), and the line is flagged `costIsEstimated`; `GET /reports/profit` reports
  `estimatedCost`. Costing them at zero silently lost the real cost from every report, forever —
  on a 2–3% margin that is the whole signal.

**Vendor purchase targets are built** (§12): `PurchaseTarget` plus `GET /purchase-targets/report`,
in `src/modules/reports/` — the only writes in an otherwise read-only module, because a target is
meaningless apart from the report measuring it. Four rules are load-bearing: progress counts
goods **received** not ordered; quantity comes from **`quantityPaidFor`**, so free goods do not
advance a quota; value comes from `GoodsReceiptLine.totalCost`, never `costPrice × quantity`; and
**a category target counts only the products in it that carry no target of their own**, or one
carton advances two rows. That subtraction is pure, in `purchase-target.ts`. Targets are
deliberately **not** on `GET /reports/dashboard`: `targetValue` is a buying price and reps see the
dashboard.

**Money owed to vendors is Slice 6.6** (§16), in `src/modules/payables/`. `GET /payables` is the
mirror of `GET /receivables` — bills with money still on them, longest-owed first, grouped per
vendor, with `total` as the headline figure the dashboard shows and the list behind it as what a
click opens. Six rules are load-bearing:

- **Receipt is goods, bill is money.** `GoodsReceipt` stays the record of what physically arrived;
  `SupplierBill` is what the vendor is owed for it. Separate because an **opening balance has no
  receipt** — and an opening balance must never create stock, since the goods behind it arrived and
  probably sold long ago, and inventing movements would break the invariant smoke exists to check.
- **Every delivery raises a bill**, whether or not anyone asked. A delivery nobody paid for *is* a
  debt, and a receipt that raised no bill would be money owed that never appears on `/payables`.
  Paid in full at the door is no exception: the bill opens and the payment closes it in the same
  transaction.
- **`amountDue` is stored, not derived.** It defaults to the sum of the goods lines but is its own
  column, because a vendor invoice routinely carries a delivery charge or a settlement discount
  that no stock line can hold. It deliberately does **not** feed inventory cost — §2 still values
  stock from `GoodsReceiptLine.totalCost`.
- **One payment settles exactly one bill.** No allocation table, unlike the customer side: vendors
  here are paid on delivery or against one specific supply. Lump sums across several deliveries
  would need allocations, and that is a migration on the day somebody actually does one.
- **A supplier payment is never an `Expense`.** Buying stock already reaches profit through cost of
  goods sold; logging vendor payments as expenses would count the same money twice and understate
  every margin. This is the trap worth remembering.
- **Void, but no negative payments.** A mis-key is voided and the bill goes back to owing. Money
  genuinely coming back from a vendor is not a case this business has — the column is ready for it,
  the write path is not.

`GET /reports/purchases` is the buying-side counterpart of `/reports/sales`, summed from
`GoodsReceiptLine`, so it is correct for months that happened long before it was written. Value is
the exact invoice total, never `costPrice × quantity`; quantities report **both** received and paid
for, and the gap is free goods.

All of it is buying-price data and closed to `sales_rep`. Both halves reach
`GET /reports/dashboard` under `purchasing`, which was safe to do because **that endpoint has
always been `@Roles(...SEES_COST)`** — the older note saying targets were kept off it because
"reps see the dashboard" described a risk the route had already closed.

**Payments name the account they landed in** (§11). `BankAccount` is the set of accounts the
business is paid into — several is normal, five is not unusual — and `Payment.bankAccountId` says
which took each payment, so a statement reconciles by joining rather than by eye. **`transfer` and
`pos` must name one; `cash` must not**, and it is **never defaulted** for a caller who did not
choose, because a wrong account only surfaces at reconciliation. An account with payments against
it cannot be deleted, only deactivated. `GET /reports/collections` breaks down per account as well
as per location. Gateways like Paystack are deliberately *not* modelled as a method: one deducts a
fee and settles later, and belongs in its own slice.

**PDF invoices and statements are built** (§6), in `src/modules/documents/`:
`GET /sales/:id/invoice.pdf` and `GET /customers/:id/statement.pdf`. **`pdfmake`, pinned to the
0.2 line** — 0.3 is a rewrite its own types do not match, and `@types/pdfmake` covers only the
browser API, so the server printer is declared in `documents/pdfmake-node.d.ts`. Not Puppeteer:
Chromium is ~300MB and Render's free tier already has 30–50s cold starts. Four rules: the
documents **recompute nothing** (they read `SaleService.receipt` and `ReceivableService.statement`,
so print and screen cannot disagree); **VAT prints as "of which"**, never added on top, because
prices are tax-inclusive; money prints as `NGN 2,500.00` because the built-in fonts have no ₦
glyph; and **every active bank account is printed, default first**.

`Organization` carries an optional letterhead — address, phone, email, taxId, rcNumber, logoUrl —
**all nullable on purpose**: a business that never opened the profile screen must still be able to
invoice today, so the renderer prints what it has. `GET /organization` is open to every member;
`PATCH /organization` is owner/manager and **cannot** change currency, timezone or invoice
numbering.

**Secrets leave the database only where something asks for them by name** (§9). A pre-deployment
review found `GET /users/:id` returning **argon2 password hashes to any authenticated caller in any
organization** — the `@Exclude()` decorators that looked like protection were inert, because
`ClassSerializerInterceptor` was never registered. The rule now is **select, never exclude**:
`PUBLIC_USER_SELECT` in `user.action.ts` is an allow-list, so a new column is invisible until
someone adds it deliberately. The hash is reachable only through `getCredentials`. `User` cannot
join `TENANT_SCOPED_MODELS` — a person may belong to several businesses — so **scoping is applied
by hand** in `list()` and `findOneVisibleTo()`; an outsider gets a 404, not a 403. Smoke scans
*every* response in the run for an argon2 hash. **`OTP_OVERRIDE` is ignored in production**, and
`SWAGGER_ENABLED` defaults to off.

**Cost is redacted in one place, and reads are guarded like writes** (§9). A second pre-deployment
sweep on 2026-09-18 found no way in from outside — auth, tenancy and the tenant extension all held
— but nine endpoints enforced a role on the write and nothing on the `GET` beside it. Buying prices
were closed on `GET /reports/profit` and open on `GET /products`, `GET /sales`, `GET /stock/levels`,
`GET /goods-receipts` and `GET /reports/sales`, which is the same margin grouped by product.
`SEES_COST` and `redactCost` now live in `src/common/authz/cost-visibility.ts` — **use them for any
new field that reveals what goods cost.** Two rules about redaction: it happens at the **read edge**
(`findAll`, `findOne`) and never in a shared `include`, because `SaleReturnService` reads the real
`costOfGoodsSold` and would compute `NaN` against a redacted row; and a field is **removed, not
zeroed**, because a zero reads as "free goods" to anything that sums it.

**A third leak turned up on 2026-09-25, on an endpoint that sweep had already been through**:
`GET /sales` redacted `costOfGoodsSold` line by line and passed the header's `costTotal` straight
out — the same numbers summed, next to the `total` they sold at, which is the margin. Two lessons
worth more than the fix: **redact the header and the lines together** (`SALE_COST_FIELDS` sits
beside the other two in `sale.service.ts`), and **a redaction test proves nothing about a field its
fixture does not set** — `not.toHaveProperty` passes happily on a mock that never had the key.

Four more rules from that pass: **a negative payment needs the same authority as a void** (owner,
manager, accountant — a cashier could otherwise cover a till shortage with a refund); **resetting a
staff password or suspending someone revokes their sessions**, since the owner believes they have
just locked that person out; **`switchOrganization` is the third path that mints a session and
checks working hours** — a fourth would need the same line; and **`RESEND_API_KEY` and `MAIL_FROM`
are required in production**, because the log fallback writes OTPs and reset links in plaintext.
`npm audit` is at **0 vulnerabilities**: the nine deferred advisories were all transitive and closed
with `overrides`, keeping Prisma 7 and NestJS 11 — **still never run `npm audit fix --force`**.

**`forbidNonWhitelisted: true` on the global `ValidationPipe` is a security control**, not tidiness.
The tenant extension does not rewrite `update.data`, so what actually stops a row being moved to
another organization is that pipe rejecting an unknown `organizationId` property first.

**Rate limiting counts people, not addresses** (§9). `PerUserThrottlerGuard` keys on the signed-in
user and falls back to IP for anyone not signed in, so brute-force protection on login is
unchanged while four cashiers behind one shop router no longer share a single allowance. **This
depends on `JwtAuthGuard` being registered before the throttler** in `AppModule`; reordering them
silently reverts it to counting a whole shop as one client.

**Staff, and why a cashier has no email** (§9). Most cashiers in this market have no working
address, so `User.email` is **nullable** and `User.username` sits beside it — stored qualified by
the org slug (`amina@adebayo-stores`), which makes it globally unique for free. Login takes
either. The token's `email` claim is nullable and deliberately does *not* fall back to the
username. Owners add staff through `/staff`, **owner-only for writes**; accounts are created
**pre-verified** because a code would never arrive, and the owner can reset a staff password since
self-service reset can never reach them.

**`Organization.maxUsers` (default 5) is the pricing lever** — a column, not a constant, so the
tier line moves without a migration. Checked **on adding and reactivating, never on signing in**:
a business over its limit keeps working. Only active members hold a seat. The last owner cannot be
demoted or suspended, and nobody can change their own role. Removal is **suspension**, effective on
their next request.

**Working hours gate signing in, not working** (§9). The business sets `opensAt`/`closesAt`
(minutes past midnight, org timezone) and `workingDays`; a `Membership` overrides them only when
that person differs, and **null means inherit** so a new hire is covered without anybody
remembering. **Checked when a session is issued or renewed — never on an ordinary request** — so
somebody is locked out within 15 minutes of closing and never mid-sale. Both
`AuthService.issueForUser` and `TokenService.rotate` must call it, or signing in at 18:55 would buy
the whole night. **Owners are never locked out**; anyone else can be exempted with
`ignoresWorkingHours`. No window crosses midnight — a CHECK enforces it, and that is what makes
night shifts a real change later. The arithmetic is pure, in `staff/working-hours.ts`.

**Running `npm run smoke` twice inside a minute fails** with a 429 on login: login allows five
attempts a minute per address and the staff step spends them. That is the rate limiter working;
wait a minute.

Smoke also used to fail after 7pm, on a 403 from the staff sign-in: a new org defaults to
08:00–19:00 and every cashier login in the script inherits it. The staff section now opens the shop
for the whole day first — the working-hours section further down still shuts it explicitly to test
the refusal — so a run at any hour is green.

**The backend is feature-complete. Next: the web dashboard (§17), then deploy.** It is planned as
slices 7.0–7.6 in `web/`, a sibling of `src/` — **Vite + React + TypeScript**, not Next.js and not
a monorepo restructure. Four rules are fixed before the first screen: types are **generated from
the OpenAPI document**, never imported from Prisma; auth is the **httpOnly cookies already built**,
never a token in JavaScript; **cost fields may be absent rather than null**, because `redactCost`
removes keys; and every write carries a client id and an `Idempotency-Key`, because on a till a
double-click is a double sale. The dashboard serves owners, managers **and the counter** — sales
are rung up on web as well as mobile. v1 was redefined on
2026-09-19 as **backend + web dashboard, then deploy** — the dashboard used to sit after
deployment, which ships a URL rather than a product. **v2 is scoped in
[docs/PRD-V2.md](docs/PRD-V2.md)**: variants, reservations and orders taken over WhatsApp, bank
statement import, then pre-order. Each step has a gate, and the gates are the point — `MARKET.md`
§6 names one developer's time as the binding constraint.

Three v2 decisions are already made and worth knowing before touching the catalog or the ledger:
**a variant is an optional sub-identity, not another product** (nullable `variantId`, so FMCG is
untouched — and adding it to the `StockBalance` unique key will hit the §13 nullable-unique trap);
**a reservation is not a stock movement** but a claim on a future one, since the ledger is
append-only; and **a bank statement importer proposes, a person confirms** — nothing writes a
payment on its own.

(§15 item 14's nine dependency advisories are **closed**, not deferred; **do not run
`npm audit fix --force`**, which would still downgrade Prisma 7 to 6.) The **deploy to Render** plan
is §15 item 1, and it comes **after** the dashboard, not before it — v1 was redefined on 2026-09-19
so that what ships is something a shop owner can open. It is on a **paid tier**, which supersedes
that item's free-tier assumptions: no cold starts, no expiring database, no warm-up request before
smoke. `OTP_OVERRIDE` stays **test-instance-only regardless of tier**, because paying for the
instance does not stop it being a master key into every account.

On printing generally: thermal receipts (Bluetooth ESC/POS) are the mobile app's job — the server
cannot reach a paired printer — and `GET /sales/:id/receipt` is already the stable payload for
it. PDFs are the server's job. Barcode label sheets are deferred. See §6.

**Before declaring anything done, run `npm run smoke`** — `test/smoke.mjs` walks the whole API
against a running server. Its load-bearing check is that the sum of every stock movement equals
the sum of the stock levels; a sale that deducts wrongly breaks that and nothing else does.

The detail — what is verified against a running server, what is still outstanding, and the full
next-step list — is in [docs/DECISIONS.md](docs/DECISIONS.md) §14 and §15. This section is the
short version; that one is authoritative.

## Working practice

- `main` (release, tagged) → `dev` (integration) → short-lived feature branches merged `--no-ff`.
  Never commit to `main`.
- Plan → get approval → build, one slice at a time.
- A branch is done when `npm run typecheck`, `npm run lint`, `npx jest` and `npm run build` are
  all clean **and** the behaviour is verified against a running server.
- **Finishing a slice means updating the docs in the same branch**: the "Where things stand"
  section above, and `docs/DECISIONS.md` (§14 status, §15 next, the roadmap table, plus any
  decision made or trap hit along the way). The chat gets cleared between slices, so these two
  files are the entire handover — if it is not written down here, the next session does not know it.
- **Never edit a doc with PowerShell `Get-Content -Raw` / `Set-Content`.** PS 5.1 reads UTF-8 as
  ANSI and writes it back mangled — every `—` and `₦` becomes mojibake — and `$` in a regex will
  not match a CRLF line ending, so the replacement silently does nothing while the file is
  corrupted anyway. Use the editing tools.

## The web dashboard (`web/`)

Slice 7, planned in §17. **Vite + React + TypeScript**, with its own `package.json` — run
`npm install` and `npm run dev` from inside `web/`. It reaches the API over HTTP at `VITE_API_URL`
and shares no code with it.

**Where it has got to: 7.0 (foundation, sign-in), 7.1 (home), 7.2 (the till) and 7.3 (sales,
returns, customers, statements, PDFs) are done. 7.4 is next**: receivables, payables, supplier
bills and payments, expenses, bank accounts. The slice table is in §17. Both servers have to be
running to work on this: the API on 4000, then `npm run dev` in `web/` on 5173, which
`CORS_ORIGINS` already allows.

- **Types are generated, never hand-written.** `npm run api:types` in `web/` regenerates
  `src/api/schema.d.ts` from the running server's `/docs-json`. **Re-run it whenever an endpoint or
  DTO changes**, or the UI types against yesterday's contract and nothing says so. Nothing in
  `web/` may import from Prisma.
- **Response shapes only exist in the contract where an endpoint declares one.** NestJS cannot
  infer a return type, so an endpoint with no `@ApiOkResponse` generates `content?: never` and the
  client is typing blind. **Every endpoint a screen reads needs a response class** —
  `reports/dto/dashboard.response.ts` is the pattern. The class must be the **service's declared
  return type** (`build(): Promise<DashboardView>`), not a hand-written mirror of it: a mirror
  drifts silently and gets believed anyway. Added per endpoint as each slice consumes it.
- **Every request goes through `src/api/client.ts`.** It sends cookies, retries once behind a
  *single shared* refresh, and puts an `Idempotency-Key` on every write. Do not call `fetch`
  directly — concurrent refreshes trip the server's token-reuse detection and log the person out.
- **Every amount renders through `<Money>`.** A cost field may be **absent rather than null**,
  because `redactCost` removes keys for roles that may not see them; a component that assumes the
  key exists prints `NaN` to a rep.
- **Money is displayed, never computed.** The one exception is the till's running total, which is
  exact only because prices are tax-inclusive — see `lib/money.ts`.
- **Role checks in the UI are navigation, not security.** The server enforces every one of them.

Four more from the till (7.2), all in `web/src/till/`:

- **The stable thing across a retry is the `id`, not the `Idempotency-Key`.** The key is bound to a
  hash of the request body, so an override retry — which adds a reason — is correctly refused if it
  reuses one. The cart mints `saleId` and a `saleLineId` per line **once** and keeps them; each
  attempt carries a fresh key. Getting this backwards makes every override fail with a 409.
- **The browser never works out a price.** Changing a unit or a customer re-prices through
  `GET /products/:id/price`. And **always pass `tierId`** — the customer's tier, else the default —
  because omitting it makes the server return the `basePrice × factor` fallback for everything,
  which is the carton overcharge §4 exists to prevent.
- **`unitPrice` is sent on every line.** The price was on the screen and probably said out loud, so
  it is what the customer pays; letting the server re-derive it lets the receipt disagree with the
  screen.
- **A 409 is a rule, not an error.** Not enough stock and "this customer still owes" both come back
  as refusals an owner or manager overrides with a reason, and **supplying the reason is the
  override**. A cashier sees the refusal and no dialog.

And three from 7.3:

- **`GET /sales` serves two readers.** `order=desc` plus `since`/`until` is the browsing half;
  `asc` is the sync default and must stay that way. Walking forward, `since` is a starting position
  a cursor overrides; walking backward, `since`/`until` are plain filters applied beside the cursor.
  The date bounds filter `createdAt`, so the screen is a ledger of what was *recorded* — reports use
  `occurredAt` and answer a different question.
- **PDFs go through `api.document`, never a plain link.** A raw navigation cannot run the refresh,
  so a link shows a JSON 401 instead of an invoice once the 15-minute token expires. Revoke the
  object URL on a timer, not immediately — immediately races the new tab.
- **A damaged return refunds money and writes no stock movement.** `restocked: false` means crushed
  goods never become sellable again, so the till must ask rather than default it.

**Quantities are integers everywhere, and half a carton is six pieces.** Typing `0.5` is refused at
three layers on purpose. Stock lives in base units, so a fraction of a bigger unit is a whole
number of smaller ones — switch the unit. Divisible goods (rice, oil) want a *finer base unit*, not
a decimal column; making `quantity` decimal is a migration across five tables that puts a
non-integer into the ledger smoke's sum-check depends on. Full reasoning in §15.

**When a demo org looks wrong, add the movement that fixes it.** The slice walkthroughs force sales
past the ledger to test the override, which leaves stock negative. Put it right with a **goods
receipt**, not by editing rows — the ledger is append-only and `npm run smoke` checks that
movements still sum to levels.

The root `tsconfig.json` and the jest config are scoped to `src` and `test` so `web/` cannot break
`npm run typecheck` or `npx jest` at the root. Keep it that way.

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
```

`npm run smoke` needs the OTP. It prompts for it, or reads it from the server's log when told
where that is:

```bash
npm run start:dev > server.log 2>&1        # terminal 1
SMOKE_SERVER_LOG=server.log npm run smoke  # terminal 2, unattended
```

Migrations: `prisma migrate dev` is interactive and fails in a non-interactive shell. Use
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
into a new folder under `prisma/migrations/`, then `npx prisma migrate deploy`.

Verifying against a running server: register through `/api/v1/auth/register`, then read the OTP
out of the server log — Resend is unconfigured, so `MailService` logs the code instead of sending
it. Check port 4000 is free first; a leftover watch server from an earlier session will let a new
one map its routes and then die on `EADDRINUSE`, leaving old code answering.
