# Architecture Decisions

The reasoning behind how this app is built. Code shows *what*; this records *why*, and
what was rejected — the part that is expensive to reconstruct.

Read this first when picking the project back up. Update it whenever a decision is made
or reversed. Last updated: 2026-08-30, end of Slice 5.

---

## 1. What the product is

A sales and inventory app for **FMCG businesses**, sold as a subscription. The wedge is that
it is **not accounting**: no chart of accounts, no double-entry ledger. It answers "what did I
sell, what is left, who owes me" — which is what people actually want from QuickBooks and mostly
do not get.

The owner runs two businesses, and both are tenants: **#1 wholesale**, **#2 wholesale and retail
combined**. Other businesses follow. Two tenants from day one is useful pressure — it means the
multi-org path is exercised by the person who notices when it breaks, and that a retail counter
and a wholesale route have to coexist in the same model rather than one being assumed.

### Roadmap

| # | Slice | Status |
|---|---|---|
| 0 | Rails: validation, CORS, Swagger, health | done |
| 1 | Tenancy + auth | done |
| 2 | Catalog: products, units, pricing, barcodes, money | done |
| 2.5 | Packaging types | done |
| 3 | Inventory ledger: movements, locations, batches, receiving, FEFO, sync | done |
| ~~4~~ | ~~Purchasing: POs, bills~~ | **cut** — see §6 |
| 4 | Sales: invoices with lines, returns | done |
| 5 | Money in: payments, receivables, expenses | done |
| 6 | Reports: dashboard, profit, stock valuation, expiry, **vendor purchase targets**, target vs actual | next |
| 7 | Web dashboard | |
| 8 | Mobile app | |
| 9 | Subscriptions and billing | |
| 10 | Telegram bot | |

Mobile sits **ahead of** Telegram: it is the primary tool for field reps, and Telegram is the
fallback for people who will not install an app.

Purchasing was cut rather than deferred, and vendor purchase targets moved to reports. The
reasoning is in §6; the short version is that this market places orders by phone, so a purchase
order is a form that generates work instead of removing it.

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

## 5. Inventory

### The ledger is append-only

`StockMovement` records every purchase, sale, return, adjustment, transfer and damage.
Current stock is **derived** from it, cached in `StockBalance` for speed and rebuildable at any
time through `POST /stock/rebuild-balances`, which reports what it corrected. An empty report is
the proof that cache and ledger agree.

A mutable `quantity` column was rejected: no audit trail, no way to answer "why is this number
wrong", corruption under concurrent sales, and it does not merge when three offline devices sync.
This is the one decision that cannot be retrofitted.

### Quantities are integers in base units

Same reason as money. Float quantities make stock counts unreconcilable.

### Quantity is signed

Positive brings stock in, negative takes it out. A balance is then a plain sum and the cache is a
running total, with no branch on movement type anywhere. The alternative — a positive magnitude
plus a direction derived from `type` — puts that branch in every query that ever adds stock up.

### Every movement carries a batch

`batchId` is NOT NULL on both `StockMovement` and `StockBalance`. Inbound stock creates a batch;
outbound references the one FEFO picked; an opening-balance adjustment invents one.

This is load-bearing in two places. It keeps `StockBalance`'s unique key
`(organizationId, productId, locationId, batchId)` free of the Postgres "NULLs are distinct" trap,
which would otherwise let duplicate balance rows accumulate silently. And it makes batch-level
stock the primary figure, with product- and location-level views as sums over it — the direction
that works, since the reverse cannot be decomposed.

### Locations are a flat list

Main store, shop counter, a rep's van. `Main Store` is seeded at registration through
`seedOrganizationDefaults`, so a business with one shop never has to think about locations at all.

Nesting (warehouse → aisle → shelf) was rejected: more than an FMCG distributor needs, and it
slows every balance query. A location holding stock cannot be deleted — movements point at it
forever, so retiring it would strand what is there where no report can see it.

### Perishables

Batch and expiry per received lot. Picking is **FEFO** — first *expired* out, not first *in* out.
For eggs and short-dated goods the two differ often enough to matter, and picking the wrong lot
costs you the older one. Undated batches sort *last*: a product with no expiry has no urgency, so
anything that can go off should leave the shelf ahead of it.

Batches are created per receipt line and never merged with an earlier delivery, even when the lot
code matches. Merging would average two invoice totals together and lose the exact figure for
each, which is the one thing that makes unit cost honest.

Breakage and spoilage are **adjustment movements with a reason**, not silent decrements. That is
the difference between "we lost ₦2,000 to breakage this month" and stock that mysteriously never
adds up.

### Negative stock: the ledger records, the write path refuses

The ledger never refuses a movement. Refusing to record what happened is how a stock count stops
reconciling, and an offline sale that syncs at 5pm already happened at 9am — the goods left the
shop and cannot be un-sold. Rejecting it at sync time would delete a real sale from the books,
which is strictly worse than a negative number.

So the policy lives in the write path instead. An outbound movement that stock does not cover is
refused with a **409 naming the shortfall**. An **owner or manager** may override with
`force: true` and a reason, which is stored on the movement as `isForced` / `forcedReason` and
listed by `GET /stock/forced`.

The owner's own scenario decided this: in a rush, with stock physically present but not yet
entered, a hard block loses the sale and a silent allowance loses the audit trail. The override
gives the person in charge one extra tap and leaves a row behind. A store that forces ten sales a
week sees ten rows saying so, which is the lever that actually gets deliveries entered on time —
not the block.

Rejected: a hard block with no override (an offline sale that syncs late gets rejected and the
rep re-enters it, or gives up); allowing anyone to override (the trail exists, but anyone can
create it). A per-organization toggle was left out as an unnecessary branch in every write path —
the override already covers the case it would serve.

Where the shortfall lands: on the batch FEFO would have picked, driving it negative, since those
goods almost certainly came from that lot. When the product has never been received at that
location, there is no lot to blame, so a batch with `quantityReceived = 0` and no cost is opened
to hang it on — which is also how those placeholder batches are recognised.

### Unit conversion happens once, on write

The vendor speaks in cartons; the ledger speaks in base units. `GoodsReceiptLine` stores what was
typed (`quantityReceivedInUnit`, `unitId`) *and* the factor applied (`unitFactor`) alongside the
converted figure. Editing what a carton contains must not retroactively change how much stock a
past delivery brought in.

### Delta sync cursors carry a safety lag

`GET /stock/movements` pages on a `(createdAt, id)` keyset, and the window stops one second short
of the server clock. See §12 — this is a trap, not a preference.

The cursor helpers live in `src/common/pagination/keyset-cursor.ts` rather than in the inventory
module, because sales pages the same way and two copies of this rule would eventually disagree.

---

## 6. Selling

### There is no purchasing slice

Purchase orders and vendor bills were planned as Slice 4 and **cut** (decided with the owner,
2026-08-29). Businesses here order by phone and record what arrived when it arrives; a purchase
order would be a form somebody has to remember to raise and then close out, which is the
QuickBooks failure mode — features that generate work instead of removing it.

Nothing depended on it. Vendor target progress had already been decided to count *goods received,
not orders placed* (§14), so the PO had no readers. `Supplier` and goods receipts already exist,
and the goods receipt **is** the record of a delivery.

Resist reintroducing it in a smaller hat: an "expected delivery", a draft receipt, a pending-order
list. Those are the same feature, and they still need someone to close them out. Vendor bills come
back only if "what do I owe this supplier" becomes a question someone actually asks, and then they
belong beside receivables, not in a slice of their own.

### A sale is priced and costed at the moment it happens

Every money figure on a sale is a snapshot: the unit price, the tax rate and amount, and the cost
of goods sold. Price lists get edited, VAT rates change, and a carton gets redefined; none of that
may rewrite what a customer paid last week. This is the same reasoning that puts `unitFactor` on
`GoodsReceiptLine`.

**Cost of goods sold is rounded exactly once**, onto the sale line, from the exact fractions of
the batches FEFO actually picked — `StockService.costOf` returns the unrounded sum precisely so
that rounding has one home. Never `costPrice × quantity`: that is the rounded average §2 forbids
as an input.

### Selling does not touch the ledger

`SaleService` calls `StockService.recordOutbound`. It does not write movements itself. FEFO
picking, the refusal to sell stock that is not there, and the owner/manager override are inherited
rather than reimplemented, so the sales path cannot drift from receiving, transfers or
adjustments. A sale of a non-stocked product — a delivery fee, a service — is priced and taxed
like anything else and simply never reaches the ledger.

### The price override *is* the discount

A line takes an optional `unitPrice`. A rep who agreed ₦4,900 on the phone types ₦4,900. There is
deliberately no discount model — no percentage fields, no discount reasons — because what the
business needs to know afterwards is what was charged, and a percentage is a worse way of
recording that than the number itself.

### A walk-in has no customer row

`Sale.customerId` is nullable. Most counter sales are strangers paying cash, and inventing a
customer for each one buries the handful of real, named customers the owner actually tracks. A
sale with no customer prices on the organization's default tier — which is what the seeded
"Retail" tier is for. `Customer.priceTierId` is how a named customer gets a different price list.

### Returns, and why there is no "void"

A return is one row per returned line, grouped by a `returnGroupId` — the same idiom that pairs
the two halves of a transfer, rather than a header table that would carry nothing. It refunds a
share of **what was actually charged**, not of the list price, and restocks into the batches the
sale drew from, so a returned carton keeps the expiry date it left with. Goods that come back
broken are refunded with `restocked: false`: the customer is made whole, and nothing unsellable
re-enters stock.

A sale rung up by mistake is returned in full. That is why there is no void, no status machine and
no delete — and it leaves both movements in the ledger, which is the honest record of what
physically happened.

### Invoice numbers are sequential per organization, and cost a row lock

`INV-0001`, from a counter on the organization row, incremented inside the sale's own transaction.
The lock that makes it gapless also serialises concurrent sales *within one tenant* — acceptable
at counter volumes, and worth knowing before anyone reports that a busy till feels sluggish. The
alternative, a UUID, is not something a customer can read out over the phone.

### `amountPaid` is gone; a sale banks its own payment

It was one integer on the sale — the full total for a cash sale, zero on credit — and Slice 5
removed the column, exactly as planned. A counter sale now writes a real `Payment` row and an
allocation against itself, **inside the same transaction as the sale**, so recording a sale is
still one round trip. That matters more than it looks: a rep at a counter with no signal cannot
be asked to make two requests that must both land, and §8 is the reason.

The request field is `payment: { amount, method, reference }`. Omitted, the sale is paid in full
in cash. `{ "amount": 0 }` is the sale that goes out on credit. Anything paid later goes through
`POST /payments`. Paying *more* than the total is refused rather than banked — change handed back
is not part of what the sale was worth.

The rules the payment itself obeys are §11.

---

## 7. Identification: barcodes now, RFID later

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

## 8. Offline-first

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

## 9. Auth

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

## 10. Working practices

- **Branching**: `main` (release, tagged) → `dev` (integration) → short-lived feature branches
  merged with `--no-ff`. Never commit to `main` directly.
- **Slices**: plan → review → build, one slice at a time. Each slice leaves a runnable app.
- **Definition of done** for a branch: `typecheck`, `lint`, `jest` and `build` all clean, plus the
  behaviour verified against a running server — not just compiled.
- **Branch protection** on a private solo repo: block force-pushes and deletions on `main`; skip
  required PRs and approvals, which just lock you out.

---

## 11. Money in

### A payment is one row per thing that happened

A ₦50,000 transfer that settles three invoices is **one** `Payment` with three
`PaymentAllocation` rows — not three payments. The test is whether the row would still line up
with a bank statement someone reconciles against, and three rows of ₦16,666.67 would not.

This is the same shape as a goods receipt: one event, many lines.

### Which invoice a payment answered is a separate claim

`Payment` records what happened; `PaymentAllocation` records *which debts it settled*. They are
different facts and they are stored separately, because the second one is exactly what customers
dispute — "that transfer was for the September invoice, not August" — and an answer that was
inferred cannot be corrected without rewriting history.

So `planAllocations` is deliberately **not clever**. It validates a caller-supplied split and
reports what is left over. `allocateOldest` exists for the caller that genuinely has no
preference, and even then it is opt-in: it runs only when no allocations were supplied at all. A
caller who named two invoices out of three meant the third to be left alone.

**Allocations may sum to less than the payment.** The remainder is credit sitting on the
customer, waiting for the next invoice. That is a real thing that happens on a route, not an
error to reject.

**Over-allocating a single invoice is refused with a 409.** Putting ₦6,000 against a ₦5,000
invoice is a typo far more often than it is generosity, and the extra belongs on the customer as
credit where the next invoice will find it.

### The amount is signed, so a refund needs no second table

Positive is money in, negative is money handed back — following `StockMovement.quantity`, which
is signed for the same reason (§5). A customer's position is then a plain sum with no branch on
"is this a refund", and cash back to a walk-in is an ordinary payment row that happens to be
negative. Allocations must agree in sign with their payment: money in settles debt, money out
unwinds it.

This is the one place `IsMoney` allows a negative, via `allowNegative`. Everywhere else a
negative amount is a bug.

### Balance is `total − allocated − refunded`

One function, [`balance.ts`](../src/modules/payments/balance.ts), because those three numbers
must never disagree. It composes with no special cases:

```
₦12,000 invoice, paid in full          → balance 0
half of it comes back as a return      → balance −₦6,000   (the shop owes the customer)
the cash is handed over, allocated     → balance 0
```

Nothing is stored. `Sale.balance` was already derived before this slice, so only the source of
the number changed — which is what made replacing `amountPaid` a small change rather than a
migration of meaning.

### Receivables is a sorted list, not 30/60/90 buckets

Aging buckets are a convention borrowed from accounting packages, and this product is
deliberately not one (§1). The question people actually ask is **"who has owed me longest"**,
which is a sort, not a histogram. `GET /receivables` returns every invoice with money on it,
oldest first, with a per-customer rollup. Buckets can be added the day somebody asks to read
them.

Money owed *back* — a sale returned after it was paid — is listed but **never netted off**
`totalOutstanding`. Netting would let one customer's credit hide another customer's debt.

### Expenses are deliberately flat

An amount, a category, a date, and who recorded it. No budgets, no approvals, no account codes.
It exists so the profit view has both halves of its subtraction: cost of goods sold comes off the
sale lines, everything else comes off here. The moment it grows an approval flow it has become
the accounting the product exists to avoid.

`ExpenseCategory` is a per-organization table rather than a Prisma enum, for the same reason
`PackagingType` is one (§4): the list grows with the business, and an enum needs a migration
every time somebody starts paying for something new. Nine are seeded at registration —
transport, fuel, diesel and power, salaries, rent, repairs, bank charges, levies and permits,
miscellaneous — through the same `seedOrganizationDefaults` both registration paths call (§12).
Deletion is soft, so a corrected month still explains what it used to say, and recreating a
deleted name revives the buried row rather than colliding with the unique constraint.

`PaymentMethod`, by contrast, **is** a Prisma enum — cash, transfer, POS, cheque. That vocabulary
is set by the payment rails, not by what a particular business does.

### Vendor bills are still not a thing

Purchasing was cut (§6), and the payments slice was where a bill would have crept back in as
"money out to a supplier". It did not. Paying a supplier is an `Expense` with a `supplierId` when
the payee happens to be on file; the goods themselves are already accounted for by the receipt
that brought them in. Nothing needs a bill to sit between the two.

---

## 12. Traps already hit

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
| **Timestamp sync cursors lose rows** | A row committed at 12:00:00.400 becomes visible *after* one committed at .600 — the timestamp is taken when the statement runs, the row appears when the transaction commits. A cursor that advances to the newest visible row steps over the straggler, and because it only moves forward, that movement is missed **forever** | `SYNC_LAG_MS = 1000` in `sync.service.ts`: the window stops a second short of now, by which time an in-flight transaction has committed. Paging is a `(createdAt, id)` keyset, so movements sharing a timestamp cannot hide each other either |
| **Upsert vs the tenant extension** | The extension injects `organizationId` into the `where` clause. `updateMany` accepts a non-unique filter there; a strict unique upsert does not | Balances move with `updateMany`, falling back to `create`, with a P2002 retry for two transactions racing to open the same balance row |
| **Git Bash converts POSIX paths in *arguments* only** | `node script.mjs /tmp/x.log` arrives as a Windows path, but `/tmp/x.log` hard-coded inside the script does not — Node resolves it to `C:\tmp\`. Cost an afternoon of a verification script reading a file that was not there | Pass paths as arguments, or use `cygpath -w`. `/tmp` here is `C:\Users\USER\AppData\Local\Temp` |
| **PowerShell 5.1 round-tripping a UTF-8 doc** | `Get-Content -Raw` reads UTF-8 as ANSI, so `Set-Content` writes back mojibake — every `—` becomes `â€"`. Worse, `$` in a `(?m)` regex will not match before a CRLF, so the bulk replacement silently matches nothing *and* corrupts the file. Both happened at once while renumbering this document | Never bulk-edit a tracked text file through PS 5.1. Use the editing tools; `git checkout --` is the recovery |
| **A leftover watch server keeps port 4000** | The new `nest start --watch` compiles, maps its routes, logs "successfully started", *then* dies on `EADDRINUSE` — leaving the previous process serving **old code** while the log looks healthy | `Get-NetTCPConnection -LocalPort 4000 -State Listen` before starting, and `taskkill /PID <id> /T /F` on the whole tree |
---

## 13. Where things stand

**Slices 0–5 done.** 238 tests across 20 suites, nine migrations,
`typecheck`/`lint`/`build` clean, and `npm run smoke` green at 179 checks against a running
server.

Slice 5 (money in) added: `Payment`, `PaymentAllocation`, `Expense`, `ExpenseCategory` and the
`PaymentMethod` enum; the `src/modules/payments/` and `src/modules/expenses/` modules; nine
expense categories seeded at registration. `src/modules/payments/balance.ts` is now the single
definition of what a sale still owes, and `src/modules/catalog/pricing.ts` was extracted so
selling prices a line from the product it has already loaded.

**`Sale.amountPaid` is dropped, and the migration truncates `sales` to do it.** Dropping the
column with rows still in the table would leave every existing sale looking unpaid, and the
alternative — backfilling a `Payment` row per sale — was not worth writing for data that only
ever came from smoke runs. Cleared rather than converted, decided with the owner; `CASCADE` takes
`sale_lines` and `sale_returns` with it. This is the same call Slice 4 made about the Slice 2
`Sale` placeholder, and it is the **last** time it is available: the next slice that touches
sales will be doing it to rows a real business cannot lose.

Three loose ends listed under "smaller things" in the last slice were closed along the way: the
double product read in `SaleService.prepareLine` (now one read via `resolveProductUnit({
withPrices: true })`), the missing `GoodsReceipt.recordedBy` relation, and
`GET /sales/:id/receipt`.

Slice 4 (sales) added: `SaleLine` and `SaleReturn`, a rebuilt `Sale`, `Customer.priceTierId`,
`Organization.nextSaleNumber`, and the `src/modules/sales/` module (renamed from `orders/`). The
Slice 2 `Sale` placeholder is **gone** — the migration truncates the table, since its rows
described sales no stock movement ever accounted for. `StockService.costOf` is the new seam
selling uses to cost a pick; `src/common/pagination/keyset-cursor.ts` now holds the cursor helpers
that inventory and sales share.

Slice 3 added: `Location`, `Supplier`, `StockBatch`, `StockMovement`, `StockBalance`,
`GoodsReceipt` and `GoodsReceiptLine`; the `src/modules/inventory/` module; and `Main Store`
seeded at registration. `Supplier` was pulled forward from the old purchasing slice so receipts
link to a real vendor from day one, and so the monthly purchase targets in §14 have their anchor.

**The regression net**: `npm run smoke` (`test/smoke.mjs`) walks the whole API against a running
server — register, catalog, receive, sell, return, take payment, chase what is owed, spend, sync,
tenancy — and is the thing to run before declaring a slice done. It is 179 checks across 28 steps
as of Slice 5. It needs the OTP, which `MailService` logs; it prompts for it, or reads it
from a log file when `SMOKE_SERVER_LOG` is set:

```bash
npm run start:dev > server.log 2>&1     # terminal 1
SMOKE_SERVER_LOG=server.log npm run smoke
```

Its load-bearing assertion is that **the sum of every movement equals the sum of the stock
levels**. A sale that deducts wrongly breaks that equality and nothing else does.

Verified against a running server, not just compiled. Slice 5's checks:

- `GET /receivables` lists only invoices with money on them, oldest first, and a sale returned
  after it was paid appears as money owed **back** without being netted off `totalOutstanding`
- a payment with no allocations settles the oldest invoice; the invoice reports what was paid
  against it and owes the rest
- the same `Idempotency-Key` replayed returns the original payment and does not bank the money
  twice — and the *same key with a changed body* is a 409, which is how the first draft of the
  smoke script found it was quietly altering the retry
- allocating more than an invoice owes is a 409; overpaying the customer's account instead leaves
  the surplus as credit, visible on `GET /customers/:id/statement` alongside a zero balance
- a refund is a negative payment with no customer account, allocated to the walk-in sale it
  reverses, and settles that sale back to zero
- an allocation whose sign runs against its payment is a 409
- `GET /payments` pages by keyset exactly as sales and the ledger do; the three counter sales each
  banked their own payment in the same request that created them
- nine expense categories are seeded per organization; expenses total per period and break down
  per category, largest first; a soft-deleted expense leaves the list and the total and 404s by id
- `GET /sales/:id/receipt` returns the narrow payload — no cost of goods sold, no tier
- a second organization sees no payments, no receivables and no expenses, and its nine categories
  are its own rows

Slice 4's checks:

- a sale spanning two lots empties the short-dated one first and takes the rest from the other,
  and its cost of goods sold is the two lots at their *own* rates, rounded once
- a walk-in with no customer prices on the seeded default tier; a customer moved onto the
  wholesale list prices on that instead
- a line with an explicit `unitPrice` charges the agreed price, not the list one
- a non-stocked product sells, is taxed, and writes no movement at all
- a sale larger than stock is a 409 that writes nothing; an owner forcing it is recorded and
  appears on `GET /stock/forced` as a `sale`
- a returned carton goes back into the lot it came from, refunds half a two-carton line, and
  leaves the sale with a negative balance — the shop owes the customer
- returning more than was sold is a 409
- invoice numbers run `INV-0001` upward per organization, and a second organization starts at
  `INV-0001` of its own

Slice 3's checks, still passing:

- a new organization is seeded exactly one location, `Main Store`, flagged default
- 20 cartons of 24 received while paying for 19, at ₦949,449: stock rises 480 base units, the
  batch holds both quantities, and the implied unit cost divides by 480, not 456 — the free
  carton pulls the cost of every unit down
- the line keeps what was typed (20 cartons) *and* the factor it was converted with
- a lot received *second* but expiring *sooner* is drawn from first, and the longer-dated lot is
  left untouched — FEFO, not FIFO
- a write-off beyond what is on hand returns 409 naming the shortfall; the same call with
  `force: true` from an owner is recorded, and appears on `GET /stock/forced` with its reason
- a transfer moves stock between two locations, both halves sharing a `transferGroupId` and the
  same `batchId`; the organization-wide total is unchanged
- paging `GET /stock/movements` two at a time returns every movement exactly once, with no
  duplicates and no gaps against a single large page; a malformed cursor is a 400
- `POST /stock/rebuild-balances` corrects nothing — the cache and the ledger agree
- a repeated `POST /goods-receipts` with the same `Idempotency-Key` replays the original receipt
  and does **not** double the stock; the same key with a different body is a 409
- org B gets `[]` or 404 for every one of org A's locations, suppliers, receipts, levels and
  movements, and can reuse a supplier name org A has taken

Carried over from Slice 2.5 and still verified: barcode resolution to unit and base quantity,
tier pricing fallback, packaging-type seeding and soft-delete revival.

**Not verified by hand**: the Google sign-up path. It calls the same `seedOrganizationDefaults`
as email registration — which is the §12 trap that put it there — so the location is seeded by
construction, but no OAuth round trip was performed.

**Not yet done**: `.gitattributes` for line endings (git warns `LF will be replaced by CRLF`;
invisible while solo, produces phantom whole-file diffs the moment a second machine touches it).

---

## 14. Next

1. **Slice 6 — reports**: dashboard, profit, stock valuation, expiry, and the vendor purchase
   targets below. Every input now exists and none of it needs a new source of truth — profit is
   sale lines minus `costTotal` minus `Expense`, valuation is the exact batch totals of §2, expiry
   is `StockBatch`, and "who owes me" is already `GET /receivables`. The slice is arithmetic over
   rows that are all being written correctly today, which is the point of having built it in this
   order.

   The one thing to decide before starting: **whether a report is computed on read or
   materialised.** Read is right until it is not, and the honest answer is that nobody knows the
   row counts yet. Compute on read, and let the first slow query say otherwise.

2. **Vendor purchase targets** (model and chart both in the reports slice — moved out of the cut
   purchasing slice, and nothing is lost by the wait: progress is summed from `GoodsReceiptLine`,
   which is append-only and accumulating now, so a target created in November still measures
   September correctly). The owner carries a monthly offtake target per vendor — "110 cartons of
   lotions, 18 cartons of roll-on" — and wants the dashboard to show target, achieved, and
   remaining. Decided with the owner:

   - **A target attaches to either a category or a single product.** "Lotions" and "roll-on" are
     `Category` rows, which already exist and are a tree. Product-level targets exist for the
     vendor that quotas one SKU.
     *Rollup rule*: a category target covers only the products in that category that do **not**
     have their own target row, otherwise the same carton is counted twice. Whatever computes the
     summary must subtract, not just sum.
   - **Scoped to a vendor** — `Supplier`, which Slice 3 built.
   - **Progress counts goods received**, not orders placed and not vendor bills. Ordered-but-
     undelivered stays in "remaining", which is the number the owner actually needs to chase.
     `GoodsReceiptLine` is the row to sum.
   - **Every target carries both a quantity and a value.** Quantity in **base units** with a
     display `unitId` — convert on write using the factor at that time, exactly as
     `GoodsReceiptLine` already does. Value in kobo, per §2.
   - **Period is a calendar month in the organization's timezone** (`Organization.timezone`,
     default `Africa/Lagos`). Not a rolling 30 days — the vendor's scheme runs on months.
   - **Free goods do not count toward the target** (confirmed by the owner, 2026-08-29). Progress
     is measured on `quantityPaidFor`: "buy 19, get 1 free" advances a 110-case target by 19, not
     20. The free case is still real stock and still absorbs into cost per §2 — it counts for
     valuation and against inventory, just not against the vendor quota.
   - **Achieved value comes from `GoodsReceiptLine.totalCost`** — never from
     `costPrice × quantity`, which is the rounded average §2 forbids as an input.

   On the chart: "target / done / left" is a progress figure, not a composition, so the summary
   tile is a **donut gauge or a stacked bar per item type** — one arc per category, done vs left —
   rather than a pie of three slices. A pie cannot compare lotions against roll-on, which is the
   comparison the owner is actually making. The owner has agreed to the donut-or-bar form; it can
   land as late as the mobile slice.

3. **`.gitattributes`** for line endings, before a second machine touches the repo.

4. **Smaller things noticed while building payments**, none urgent:
   - `ReceivableService.outstanding` loads every sale for the organization and computes balances
     in memory. Correct, and fine at the volumes a distributor reaches this year; it becomes a SQL
     aggregate the first time a business has ten thousand invoices. The rewrite is contained
     because `saleBalance` already names the arithmetic.
   - **Expenses are not on the delta-sync path.** Payments page by keyset with the `SYNC_LAG_MS`
     window; expenses return everything matching a filter. Mobile will need the cursor, and the
     helpers in `keyset-cursor.ts` already exist.
   - **A payment cannot be edited or voided** — a mis-keyed amount is corrected by recording an
     offsetting negative payment. That is almost certainly right, since it keeps the row that
     matches the bank statement, but nobody has confirmed it against how the owner actually
     handles a wrong entry today. Worth asking before the mobile slice makes it permanent.
   - **`Payment` carries no `locationId`**, so "which counter took this cash" cannot be answered.
     It does not matter until someone wants a cash-up at the end of a shift; it matters a lot on
     the day they do, and the column is much cheaper to add before there are rows.
