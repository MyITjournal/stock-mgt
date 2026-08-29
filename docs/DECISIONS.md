# Architecture Decisions

The reasoning behind how this app is built. Code shows *what*; this records *why*, and
what was rejected — the part that is expensive to reconstruct.

Read this first when picking the project back up. Update it whenever a decision is made
or reversed. Last updated: 2026-08-29, end of Slice 2.5 (plus the vendor-target requirement in §12).

---

## 1. What the product is

A sales and inventory app for **FMCG businesses**, sold as a subscription. The wedge is that
it is **not accounting**: no chart of accounts, no double-entry ledger. It answers "what did I
sell, what is left, who owes me" — which is what people actually want from QuickBooks and mostly
do not get.

The owner's own business is tenant #1; other businesses follow.

### Roadmap

| # | Slice | Status |
|---|---|---|
| 0 | Rails: validation, CORS, Swagger, health | done |
| 1 | Tenancy + auth | done |
| 2 | Catalog: products, units, pricing, barcodes, money | done |
| 2.5 | Packaging types | done |
| 3 | Inventory ledger: movements, batches, expiry | next |
| 4 | Purchasing: suppliers, POs, receiving, bills, vendor purchase targets | |
| 5 | Sales: invoices with lines, returns | |
| 6 | Money in: payments, receivables, aging, expenses | |
| 7 | Reports: dashboard, profit, stock valuation, expiry, target vs actual | |
| 8 | Web dashboard | |
| 9 | Mobile app | |
| 10 | Subscriptions and billing | |
| 11 | Telegram bot | |

Mobile sits **ahead of** Telegram: it is the primary tool for field reps, and Telegram is the
fallback for people who will not install an app.

---

## 2. Money

### Integer minor units, never floats

Every monetary value is an integer count of **kobo**. `Organization.currency` says which
currency. Helpers live in [`src/common/money/money.ts`](../src/common/money/money.ts).

The reason is not "we do not trade in kobo" — it is that binary floating point cannot represent
most decimal fractions, so equality breaks:

```
3500.10 + 3500.20  =  7000.299999999999
                   === 7000.30  →  false
```

A customer pays in two instalments, the sum does not equal the total, and the app reports an
unpaid invoice. In kobo, `350010 + 350020 === 700030` exactly.

### Prices are stored tax-inclusive

The stored number is what the customer pays. VAT is **derived** by subtraction
(`splitTaxInclusive`), never stored alongside, so the two cannot disagree.
`Product.taxRateBps` holds the rate in basis points (750 = 7.5%) so the rate itself is exact.

`net + tax === gross` at every rounding boundary — there is a test asserting this across 2,000
consecutive amounts.

### Cost: store exact totals, derive averages

**The rule:** money someone actually paid is stored exactly as an integer. A per-unit average is
a *ratio*, not money — it is computed on read and never stored as a rounded number.

A figure like ₦45,211.11111 per carton is not a price anyone paid; it is already the output of a
division. What was exact was the invoice total. So the ledger stores the invoice total and the
quantity, and divides when asked:

```
6 cartons,  total ₦271,266.67   →  27,126,667 kobo
10 cartons, total ₦467,204.50   →  46,720,450 kobo
on hand: 16 cartons, 73,847,117 kobo
average: 73,847,117 ÷ 16 = 4,615,444.8125 kobo   (fractional, never stored)
```

Cost of goods sold is rounded **once**, at the moment of sale, and that integer is written to the
sale line. Consequences: stock value always reconciles (a sum of exact integers, not quantity ×
rounded average), roundings never compound, and every average is explainable from its inputs.

`Product.costPrice` is a cached rounded snapshot **for display only** — never an input to a
calculation.

### Free goods ("buy 19, get 1 free")

Not a special case. Free stock is simply *received more than paid for*, and the average absorbs it:

```
paid for   19 cartons at ₦49,971  →  total ₦949,449
received   20 cartons
cost each  ₦949,449 ÷ 20 = ₦47,472.45   (exact in kobo: 4,747,245)
```

Receiving therefore captures three numbers:

- `quantityReceived` — what physically arrived; what stock increases by
- `quantityPaidFor` — for the supplier bill, and for answering "how much free stock did this
  supplier actually give me this quarter"
- `totalCost` — exact, from the invoice; the only money stored

**Receiving screens must ask for the invoice total, not a per-unit price.** Entering
"₦45,211.11 × 6" loses a kobo before the calculation starts. Show the implied unit cost as
output, never take it as input.

---

## 3. Tenancy

An **Organization** is one business using the app — the unit that pays a subscription.
A **Membership** joins a user to an organization with a role *inside that business*
(`owner`, `manager`, `sales_rep`, `storekeeper`, `accountant`). It is a separate table so one
person can belong to several businesses — a second business, or an accountant serving clients.

`User.role` (`admin`/`user`) is the **platform** role — staff of the SaaS itself. A different
question from the org role, which is why both exist.

### Scoping is central, never per-service

Every business-owned table carries `organizationId`. The auth guard puts the caller's org into a
per-request store; a Prisma client extension
([`tenant.prisma.ts`](../src/common/tenancy/tenant.prisma.ts)) injects
`WHERE organizationId = ...` into every read, update and delete, and stamps it on creates.

If scoping were each service's job, one forgotten `where` clause would silently serve every
business's data. Centralising it means the mistake is not available to make.

**This is not theoretical.** `ProductBarcode` shipped unscoped and one org could scan another's
barcodes. The fix was a test that derives the expected list from the Prisma DMMF — it immediately
caught two more (`RefreshToken`, `IdempotencyKey`). Any new table with an `organizationId` now
fails the suite until registered in `TENANT_SCOPED_MODELS`.

Creates pass `organizationId` explicitly via `TenantContext.requireOrganizationId()` because
Prisma's generated input types require the field. The extension is the backstop, not the only line.

---

## 4. Catalog

### Products vs units

A **product** is a thing you sell. **Units** describe how it is packed: piece → pack → carton.
Units are per-product, because a carton of milk and a carton of soap hold different counts.

Exactly one unit per product has `factor = 1` — the **base unit**. All stock is recorded in base
units. This is the anchor the whole inventory design rests on: a carton broken open is still just
base units, so partial cartons need no special handling.

### Unit factors are integers, and that *is* the divisibility rule

Milo 400g Pouch, carton of 10:

```
pouch        factor 1     ₦3,500
half-carton  factor 5     ₦17,000
carton       factor 10    ₦34,000
```

Half a carton is not a fraction — it is a unit with factor 5. A **quarter** carton would need
factor 2.5, which is not an integer, so it cannot be created. The business rule ("I cannot sell a
quarter of a 10-pack") and the type constraint are the same rule. For a 12-pack, quarter units
*would* be allowed at factor 3 — also correct.

### Pricing is keyed by (tier, unit)

`ProductPrice` is `(product, tier, unit) → price`, **not** a base price multiplied by the factor.
A carton price is not ten times the piece price; bulk discount is the norm, and a model that can
only multiply cannot express it. `Product.basePrice` is the fallback when no tier row matches.

A **PriceTier** is a customer class — Retail, Wholesale, Distributor. Every organization gets a
default "Retail" tier at registration so pricing always has a home.

### Products vs packaging

"Milo 400g Pouch" and "Milo 800g Pouch" are **different products** — different barcodes,
different prices, separate stock. `PackagingType` (pouch, tin, sachet, roll, crate, bag, keg…) is
an attribute describing the base unit's physical form, so the catalog can answer "show me
everything in pouches" — `GET /products?packagingTypeId=…`.

It is a per-organization lookup table, not a Prisma enum, because the vocabulary grows and a
Prisma enum would need a migration each time. It hangs off the **product**, not the unit: a
carton of pouches is already described by the unit hierarchy, and putting a form on every unit
buys nothing the factor does not already say.

Fourteen types are seeded at registration — piece, sachet, pouch, bottle, can, tin, jar, tube,
pack, roll, carton, crate, bag, keg — numbered in tens so a business can slot its own in between.
Deletion is soft, so a product packaged in a form the business has stopped using still reports
what it was. That leaves the name occupied as far as the unique constraint is concerned, so
**re-creating a deleted type revives that row** rather than returning a 409 naming something the
caller cannot see in any list.

---

## 5. Inventory (Slice 3, not yet built)

### The ledger is append-only

`StockMovement` records every purchase, sale, return, adjustment, transfer and damage.
Current stock is **derived** from it, with a cached balance for speed.

A mutable `quantity` column was rejected: no audit trail, no way to answer "why is this number
wrong", corruption under concurrent sales, and it does not merge when three offline devices sync.
This is the one decision that cannot be retrofitted.

### Quantities are integers in base units

Same reason as money. Float quantities make stock counts unreconcilable.

### Perishables

Batch and expiry per received lot. Picking is **FEFO** — first *expired* out, not first *in* out.
For eggs and short-dated goods the two differ often enough to matter, and picking the wrong lot
costs you the older one.

Breakage and spoilage are **adjustment movements with a reason**, not silent decrements. That is
the difference between "we lost ₦2,000 to breakage this month" and stock that mysteriously never
adds up.

---

## 6. Identification: barcodes now, RFID later

### Barcodes attach to units, not products

The case carries an ITF-14 and the item an EAN-13 — different numbers for the same goods.
Attaching the code to the *unit* is what lets a scan during receiving resolve to "one carton =
24 pieces" instead of one anonymous item.

Codes are unique **per organization**, not globally: two tenants stock the same Peak Milk, and one
will invent its own internal code.

GS1 check digits are validated on entry, which catches mistyped and misscanned codes for free.
Goods arriving with no barcode get a generated internal EAN-13 in the GS1 restricted-circulation
range (leading `2`) — a real EAN-13 any scanner reads, that cannot collide with a manufacturer's
GTIN.

### One scan seam

Everything resolves through `ScanService.resolve()`. Sales, receiving, stocktake and returns all
call it rather than querying barcodes directly, so a new identifier technology is an addition to
one method rather than surgery across the app.

### RFID is a later paid tier, not the MVP

- A barcode is free (printed by the manufacturer); a UHF RFID tag costs roughly $0.04–0.15 plus
  the labour to apply it. At FMCG item values that destroys the margin.
- **Phones cannot read UHF RFID.** It needs a $500–2,000 reader. Requiring hardware before the
  feature does anything is an adoption wall for small businesses. (NFC is not a substitute: ~4cm.)
- The data shapes differ: a barcode identifies a product *class*; an RFID EPC identifies a
  specific *instance*. RFID would need a new instance-level table, not a bigger version of
  `ProductBarcode`.

Where it would genuinely pay, later: stocktake in minutes, receiving a pallet without unloading,
van reconciliation, shrinkage attribution. Caveats: liquids and metal detune UHF tags, and
over-reads create phantom inventory.

---

## 7. Offline-first

The mobile app serves **field reps as well as the owner**, on patchy connectivity, so offline
capture is a requirement. This constrains the API being built now, long before the app exists:

- **Client-generated IDs** — create DTOs accept an optional UUID, so a device offline can mint the
  row identity and sync later without renumbering.
- **Idempotency keys** — an `Idempotency-Key` header makes the first outcome replayable. A repeat
  with the same body returns the stored response; the same key with a *different* body is a 409
  rather than a misleading replay. Bodies are hashed order-insensitively, so a client that
  serialises differently on retry still matches.
- **Delta sync** (Slice 3+) — `updatedAt` cursors to pull catalog and stock changes.

Without idempotency, a flaky signal silently duplicates sales: the request succeeded but the
response never arrived, so the client cannot tell and resends.

The append-only ledger is what makes offline merging tractable — movements from three devices
combine; a mutable quantity column would corrupt.

---

## 8. Auth

JWT access tokens plus refresh tokens with **rotation and reuse detection**: replaying an
already-rotated token revokes the whole token family, so a stolen copy cannot keep renewing
alongside the real user. Refresh tokens are stored as selector + hash so a row can be found
without reversing the hash.

Tokens are returned **both** as JSON and as httpOnly cookies — one code path serving Swagger, the
mobile app and a browser dashboard.

The JWT strategy re-checks membership per request, so revoking access takes effect immediately
rather than at token expiry.

Passwords use argon2. Login is rate-limited. Mail (Resend) falls back to logging codes when
unconfigured, so OTP and password-reset flows are testable without a verified sender domain.

---

## 9. Working practices

- **Branching**: `main` (release, tagged) → `dev` (integration) → short-lived feature branches
  merged with `--no-ff`. Never commit to `main` directly.
- **Slices**: plan → review → build, one slice at a time. Each slice leaves a runnable app.
- **Definition of done** for a branch: `typecheck`, `lint`, `jest` and `build` all clean, plus the
  behaviour verified against a running server — not just compiled.
- **Branch protection** on a private solo repo: block force-pushes and deletions on `main`; skip
  required PRs and approvals, which just lock you out.

---

## 10. Traps already hit

Recorded because each cost real time and none is obvious.

| Trap | What happens | Fix |
|---|---|---|
| **Prisma 7 datasource** | `url` in `schema.prisma` is a hard error | URL lives in `prisma.config.ts`; runtime connects via the pg adapter |
| **`prisma migrate dev` is interactive** | Fails in a non-interactive shell whenever it wants confirmation | `prisma migrate diff --from-config-datasource --to-schema ... --script` into a migration folder, then `migrate deploy` |
| **`AsyncLocalStorage.enterWith()`** | Binds only the current async branch. Passport calls the guard on a branch the handler does not always descend from, so the org went missing on *some* requests | Middleware wraps each request in `run()`; the guard fills the store in |
| **`TENANT_SCOPED_MODELS` omission** | A new tenant-owned table is silently readable by every tenant | Test derives the list from the Prisma DMMF and fails until the model is registered |
| **`prisma.config.ts` in the build** | Shifts `rootDir`, emits `dist/src/main.js` while `start:prod` runs `node dist/main` | Excluded in `tsconfig.build.json` |
| **`.gitignore` had `*.spec.ts`** | Every new test invisible to git | Removed; four spec files now tracked |
| **`@t3-oss/env-core`** | ESM-only with no `main`, unresolvable under Jest's CommonJS transform | Dropped; plain zod in `env.ts` |
| **Prisma types vs the tenant extension** | Extension injects `organizationId` at runtime, but generated input types still require it | Pass it explicitly on creates; extension remains the backstop |
| **Two registration paths, one seed** | Email sign-up seeded the default price tier; Google sign-up created the organization and stopped, so those businesses had nowhere to put a price | One `seedOrganizationDefaults` both paths call. Any future per-org default goes there, not inline |

---

## 11. Where things stand

**Merged to `dev` and pushed**: Slices 0–2.5. 104 tests across 9 suites, six migrations,
`typecheck`/`lint`/`build` clean.

Verified against a running server, not just compiled:

- an EAN-13 resolves to `unit=piece, baseQuantity=1`; an ITF-14 on the same product resolves to
  `unit=carton, baseQuantity=24`
- a wholesale carton price below 24× the piece price resolves correctly, with the piece still
  falling back
- a repeated write with the same `Idempotency-Key` returns the original row and
  `Idempotent-Replay: true`; the same key with a different body returns 409
- org B gets `[]` for org A's products, 404 by id, 404 on PATCH/DELETE, and can independently
  reuse the same SKU and the same barcode
- each organization is seeded its own 14 packaging types; org B gets 404 for org A's `pouch` by
  id, and 404 when creating a product against it
- `?packagingTypeId=` returns only the pouches; deleting `pouch` hides it from the list while the
  product it was on still reports it; re-creating `pouch` returns the same row id

**Not yet done**: `.gitattributes` for line endings (git warns `LF will be replaced by CRLF`;
invisible while solo, produces phantom whole-file diffs the moment a second machine touches it).

---

## 12. Next

1. **Slice 3 — inventory ledger**: `StockMovement` (append-only), locations, batches and expiry,
   receiving with `quantityReceived`/`quantityPaidFor`/`totalCost`, FEFO picking, damage
   adjustments with reasons, and delta-sync cursors.

2. **Vendor purchase targets** (model lands in Slice 4, dashboard in Slice 7/8). The owner carries
   a monthly offtake target per vendor — "110 cartons of lotions, 18 cartons of roll-on" — and
   wants the dashboard to show target, achieved, and remaining. Decided so far:

   - **A target attaches to either a category or a single product.** "Lotions" and "roll-on" are
     `Category` rows, which already exist and are a tree. Product-level targets exist for the
     vendor that quotas one SKU.
     *Rollup rule*: a category target covers only the products in that category that do **not**
     have their own target row, otherwise the same carton is counted twice. Whatever computes the
     summary must subtract, not just sum.
   - **Scoped to a vendor**, once `Supplier` exists in Slice 4. Until then there is nothing to
     hang it on, which is why this is not Slice 3.
   - **Progress counts goods received**, not orders placed and not vendor bills. Ordered-but-
     undelivered stays in "remaining", which is the number the owner actually needs to chase.
   - **Every target carries both a quantity and a value.** Quantity in **base units** with a
     display `unitId` (the vendor speaks in cartons; the ledger speaks in base units — convert on
     write, using the unit factor at that time, and store the base figure so a later factor change
     cannot rewrite history). Value in kobo, per §2.
   - **Period is a calendar month in the organization's timezone** (`Organization.timezone`,
     default `Africa/Lagos`). Not a rolling 30 days — the vendor's scheme runs on months.
   - **Free goods do not count toward the target** (confirmed by the owner, 2026-08-29). Progress
     is measured on `quantityPaidFor`: "buy 19, get 1 free" advances a 110-case target by 19, not
     20. The free case is still real stock and still absorbs into cost per §2 — it counts for
     valuation and against inventory, just not against the vendor quota.
   - **Achieved value comes from the receipt's `totalCost`**, apportioned — never from
     `costPrice × quantity`, which is the rounded average §2 forbids as an input.

   On the chart: "target / done / left" is a progress figure, not a composition, so the summary
   tile is a **donut gauge or a stacked bar per item type** — one arc per category, done vs left —
   rather than a pie of three slices. A pie cannot compare lotions against roll-on, which is the
   comparison the owner is actually making. The owner has agreed to the donut-or-bar form; it can
   land as late as Slice 9.
