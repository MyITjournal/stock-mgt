# Architecture Decisions

The reasoning behind how this app is built. Code shows *what*; this records *why*, and
what was rejected — the part that is expensive to reconstruct.

Read this first when picking the project back up. Update it whenever a decision is made
or reversed. Last updated: 2026-08-31, end of the Slice 6.1 gap-closing pass.

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
| 6 | Reports: dashboard, profit, sales, stock valuation, expiry, movers, alerts | done |
| 6.1 | Gap-closing: sync correctness, cash-up, the no-credit rule, images, stocktake | done |
| 6.5 | **Vendor purchase targets**, target vs actual, **PDF invoice + statement** | done |
| 6.6 | **Vendor payables**: what I owe, supplier payments, purchases summary | done |
| 7 | **Web dashboard** — v1 does not ship without it; planned in §17 as 7.0–7.6 | 7.0–7.6a done; **7.6b next** |
| — | **Deploy to Render** — free tier, once the dashboard exists | after 7 |
| 8 | Mobile app | |
| 9 | Subscriptions and billing | |
| 10 | Telegram bot | |

**v1 = backend + web dashboard, then deploy** (2026-09-19). The dashboard used to sit *after*
deployment, which ships a URL rather than a product: an API with no interface has no users and
nothing to sell, and MARKET.md §6 ends "then stop and sell". v2 is scoped in
[PRD-V2.md](PRD-V2.md) and starts only once a real user has touched v1.

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

### When the goods outrun the paperwork, estimate — and say so

Stock arriving and being sold before the delivery note is entered is normal in this trade, not an
edge case. When it happens the outbound movement is forced through a shortfall onto a batch that
has no invoice behind it.

That batch used to cost **nothing**, and the consequence was worse than it looks:

```
10 cartons arrive, ₦600,000
1 force-sold before the paperwork  → cost of goods sold 0
delivery then recorded, 10 @ ₦600,000
the remaining 9 sell at ₦60,000 each → ₦540,000

total cost ever recorded  ₦540,000
actually paid             ₦600,000
```

₦60,000 of real cost never appears in any report, **permanently** — and stock levels still
reconcile, so nothing looks wrong. On a 2–3% margin that is the difference between a profit and a
loss, reported as a sale with 100% margin.

So the rate now comes from **the product's most recent real delivery**, and the sale line carries
`costIsEstimated`. A guess close to the truth beats a zero that is certainly wrong, and the flag
is what stops it passing as a measurement: `GET /reports/profit` reports `estimatedCost` and
`estimatedLines`, so an owner reading a thin margin can see how much of it rests on paperwork that
had not arrived.

Two deliberate limits:

- **Zero survives in one case**: a product that has never been received at all. There is no
  earlier rate to borrow, and the cost is genuinely unknown rather than merely unrecorded.
- **Old sales are never recomputed** when the delivery is finally entered. Rewriting a margin
  somebody has already read and acted on is exactly the spreadsheet behaviour this design exists
  to escape — see §1. The estimate stands, flagged, and the truth arrives with the next lot.

This reverses an earlier decision that costed such a batch at zero on the grounds that it had no
invoice to divide. That was defensible and wrong: it optimised for the purity of the number over
the honesty of the total.

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

### The base unit is the piece, even where pieces are not sold

Confirmed with the owner, 2026-08-31. Most products here are not sold in pieces — a Soft Cup
carton is 8 packs of 3, and the pack is the smallest thing that leaves the shop. The tempting
setup is therefore `pack = 1`.

**Set the piece as the base anyway**, with `pack` and `carton` as units above it. Two reasons:

- Some vendors *do* break packs, and the model has to hold them.
- The choice is close to irreversible. Factors must be integers, so if `pack = 1` and a piece is
  later needed, a piece would want factor ⅓ — which the divisibility rule forbids. Undoing it
  means rewriting every movement, sale line and batch quantity in history, against an append-only
  ledger designed to resist precisely that.

The cost of choosing piece is small and one-directional: stock counts read in pieces rather than
packs. The cost of choosing pack and being wrong is a migration of the whole ledger.

This is also what makes the spreadsheet's fractions go away. A sheet tracking cartons records
`0.25` and needs the carton size to interpret it; the ledger records 2 packs — or 6 pieces — as an
integer, and the invoice says "2 packs".

**Known gap**: nothing currently *forbids* selling a unit. `isDefaultSelling` only chooses which
one is pre-selected, and pricing falls back to `basePrice × factor` for any unit without a tier
price, so a piece stays sellable if a client offers it. Enforcing "we never sell pieces" needs a
flag that does not yet exist — see §15.

### Pricing is keyed by (tier, unit)

`ProductPrice` is `(product, tier, unit) → price`, **not** a base price multiplied by the factor.
A carton price is not ten times the piece price; bulk discount is the norm, and a model that can
only multiply cannot express it. `Product.basePrice` is the fallback when no tier row matches.

A **PriceTier** is a customer class — Retail, Wholesale, Distributor. Every organization gets a
default "Retail" tier at registration so pricing always has a home.

### Prices and barcodes are set on the product, not through endpoints of their own

Decided with the owner on 2026-09-16, after the gap in §15 item 10 turned out to be a live
overcharge rather than a missing convenience.

`POST /products` took `basePrice` and `costPrice` but had no way to set a **carton** price, and
`POST /products/:id/prices` was a separate call nobody was obliged to make. Meanwhile
`resolveUnitPrice` falls back to `basePrice × factor`, and `SaleService.resolveTierId` hands every
walk-in the seeded default tier — so **the fallback was the default path, not an edge case**. A
product created with piece + carton sold a carton at 24 × the piece price, silently, until
somebody remembered to post a price row per tier per unit. On the margins in this market that is
not a rounding difference; it is the whole bulk discount, charged to the customer.

The asymmetry that made it visible is worth keeping in mind when adding any future field:
`costPrice` was accepted at create and is **display only** per §2, while the carton price — which
changes every sale — was the one the form would not take. The field that changed no number was
the one that was easy to supply.

So both now live in the product payload, and `POST /products/:id/prices` is gone:

- **Keyed by unit name, not unit id.** At create time the caller has no unit ids, because the
  units are being created by the same request. Names are what the caller already typed.
- **`tierId` is optional**, defaulting to the organization's default tier — which is what a
  walk-in gets, so it is the answer somebody filling in a product form has in mind.
- **PATCH upserts what it lists and leaves the rest alone.** Replace-all would let a PATCH naming
  one unit silently delete the prices of every other: the same shape of silent loss as costing a
  forced sale at zero, and just as invisible afterwards.
- **The scaling fallback stays.** It is right for a sachet against a piece, and refusing to price
  an unpriced unit would break the common case. `GET /products/:id/price` already returns
  `isTierPrice`, which is how a client marks a number as a guess rather than a decision.

**`POST /products/:id/barcodes` survives**, and this is the asymmetry with prices. A price is
settled when the product is defined. A barcode is not: a supplier changes packaging, an unbarcoded
item gets an internal EAN-13 minted later, several codes circulate for one unit while old and new
packaging are both on the shelf, or somebody is at the counter with a scan gun and a product that
already exists. Routing that through a whole-product update means reading the product, appending
to an array and sending it back, to add one code. Barcode validation is shared rather than
duplicated: `resolveBarcode` in `barcode.ts` is the single verdict both paths reach, because a
code that scanned one way at the counter and another way through the product form is a difference
nobody would find until the labels were printed.

### Product images: two columns, and neither is required

`imageUrl` is what clients render. `imagePublicId` is what lets the previous image actually be
deleted from the CDN when it is replaced — store only the URL and every change leaks an orphan
nobody will ever find.

The public id stays null when the URL was **supplied directly**, which is the second point: a
business that already hosts its product shots is not forced through our uploader, and a server
with no image hosting configured can still show pictures. `POST /products/:id/image` exists for
everyone else, and returns a **503 naming the missing environment variables** rather than failing
somewhere inside the CDN's SDK — the credentials are optional in `env.ts` and unset on every
development machine, so that path is the normal one, not the exceptional one.

Replacing deletes the old image *after* the new one is stored, so a failed upload leaves the
product with the picture it had. A failed delete is swallowed: the product is already correct, and
an orphaned file is not worth failing a request the user experienced as working.

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

### Stocktake: counting is not adjusting

A physical count is recorded first and **posted** second, and the two are
deliberately different acts by different people. A storekeeper walks the aisles
and records what is on the shelf; an owner or manager looks at the variance and
decides it is real. Until it is posted, an open stocktake changes nothing about
stock on hand — it is a claim about the world, not a change to it.

The split is not ceremony. A counter who can both report a shortfall and approve
it can walk out with the difference, which is why posting is restricted to
owner and manager while counting is open to the storekeeper and the rep. Same
reasoning as the forced-movement override above.

Posting writes ordinary `adjustment` movements with reason `count_correction`,
so the ledger stays the only source of truth for stock and a posted count is
readable afterwards as exactly the movements it caused. Nothing about a
stocktake is a second stock table.

Three rules that are easy to get wrong:

- **The variance that posts is recomputed against live stock**, not against the
  figure captured while counting. Goods move between the count and the decision,
  and the ledger has to record what was true when the correction was made. The
  snapshot on the line is kept as *evidence* — so the sheet still explains itself
  weeks later — but it is never the arithmetic.
- **A surplus needs a lot, because every movement carries a batch.** Extra units
  found on a shelf have no lot of their own, so they land on the most recently
  received batch still holding stock there, which keeps the cost basis current.
  Failing that, the newest batch of that product anywhere. Only a product that
  has never been received needs a lot invented, and that one is honestly worth
  nothing until somebody says otherwise — §2 stores what was paid, and nothing
  was. Shortfalls need no such rule: they leave FEFO, exactly as a sale would.
- **One open count per location.** Two would post variances against each other's
  corrections, and the second would be measuring the first.

### Unit conversion happens once, on write

The vendor speaks in cartons; the ledger speaks in base units. `GoodsReceiptLine` stores what was
typed (`quantityReceivedInUnit`, `unitId`) *and* the factor applied (`unitFactor`) alongside the
converted figure. Editing what a carton contains must not retroactively change how much stock a
past delivery brought in.

### Delta sync cursors carry a safety lag

`GET /stock/movements` pages on a `(createdAt, id)` keyset, and the window stops one second short
of the server clock. See §13 — this is a trap, not a preference.

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
not orders placed* (§15), so the PO had no readers. `Supplier` and goods receipts already exist,
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

### There is no credit limit, because there is no credit facility

Confirmed with the owner, 2026-08-31: **the product does not sell on credit as a
matter of course.** Credit happens — a shop takes goods on Tuesday and pays on
Friday — but it is an exception, and the rule the business actually runs on is
that what is owed is cleared before more goes out.

So there is no `creditLimit` column and there never was a reason for one. A
limit is a number you top up against; this is a gate. Selling on credit to a
customer who already has an unsettled balance is refused with a **409 naming the
invoices and the amount**, and an owner or manager can overrule it by supplying
`creditOverrideReason`, which is stored on the sale.

Three details worth keeping:

- **Supplying the reason *is* the override.** There is no separate boolean, so an
  override can never be recorded without a reason — the same trick as voiding a
  payment, and for the same purpose.
- **Only positive balances count.** A customer the business owes money to, after
  returning goods they had paid for, is not in debt; blocking their next purchase
  over it would be nonsense.
- **Paying in full is never blocked.** The rule is about credit, not about the
  customer. Someone who owes can still buy for cash, and does.

Encoding this stops a rep letting one shop's debt compound across three
deliveries, which is how a distributor's receivables become uncollectable. The
ledger still records whatever actually happened; it is the *write path* that is
opinionated, exactly as with negative stock (§5).

### Printing: the server serves payloads and PDFs, the device drives the printer

`GET /sales/:id/receipt` returns a deliberately narrow payload — what the customer is handed and
nothing else, with no cost of goods sold and no tier on it. It is kept separate from the sale
row because a receipt is a **contract with a printer**: it has to keep saying the same things in
the same shape while the sale model underneath keeps growing.

Three printing needs, and they do not belong in the same place (decided 2026-08-30):

- **Thermal receipts** (58/80mm Bluetooth ESC/POS — what a counter and a van actually use) are
  **client-side, in the mobile slice**. Not a decision about layering: the server cannot reach a
  Bluetooth printer paired to a phone. The payload above is the whole of the server's part.
- **A4 / PDF invoices and customer statements** are **server-side, with the reports slice**. A
  wholesale buyer wants a document, and a debtor gets chased over WhatsApp — neither survives as
  JSON. It lands with reports because it shares the rendering dependency, and because a statement
  is a receivables artifact rather than a new source of truth.
- **Barcode label sheets** are deferred. The internal EAN-13 generator in §7 exists so labels
  *can* be printed; nothing renders a sheet yet, and nothing needs one until there is a screen to
  press the button on.

### PDFs: pdfmake, and why not a browser

Built 2026-09-17 in `src/modules/documents/`: `GET /sales/:id/invoice.pdf` and
`GET /customers/:id/statement.pdf`.

**`pdfmake`, not Puppeteer.** Puppeteer renders HTML and CSS, so the output would be prettier and
the templates far pleasanter to write. It also ships Chromium — roughly 300MB, hundreds of
megabytes of RAM per render, and seconds of start-up. Deployment is Render's free tier, which §15
already records as having 30–50 second cold starts, so a browser per PDF is the wrong trade on the
host this is going to. An invoice is a header, a table and a totals block, which is what a
document-definition library does well, and it handles a long invoice flowing onto a second page
without being asked.

**Revisit it** if the invoice becomes a branded, designed artifact, or on a host with room for
Chromium. Hosted HTML-to-PDF APIs were rejected outright: they would mean sending customers'
invoice data to a third party, which is a decision rather than a detail.

**Two implementation notes worth keeping.** The dependency is pinned to the **0.2 line**; 0.2 is
the stable Node API that `@types/pdfmake` and every piece of documentation describe. 0.3 is a
rewrite whose module layout its own published types do not match — `new PdfPrinter()` is not even
constructable from the documented import. And `@types/pdfmake` only types the *browser* entry
point, so the four members of the server-side printer are declared by hand in
`documents/pdfmake-node.d.ts` rather than reaching for `any`.

**Money prints as `NGN 2,500.00`, not `₦2,500.00`.** The 14 built-in PDF fonts carry no ₦ glyph,
and a missing glyph renders as a blank or a box on a document a customer is meant to pay from.
Using the built-ins means no font files are shipped or loaded; the cost is Helvetica and the
currency code.

**The documents recompute nothing.** The invoice reads `SaleService.receipt` and the statement
reads `ReceivableService.statement`, so a printed document and the screen it was printed from
cannot disagree — the same rule §12 applies to every other figure.

**VAT prints as "of which", never as an addition.** Prices are stored tax-inclusive (§2), so
adding the tax line to the total would overstate the bill by 7.5% on the one document where that
matters most.

**The statement lists payments as well as debts.** A statement showing only what is owed reads as
an accusation and invites an argument about money that was in fact received; an itemised position
is answerable, which is the whole point of the artifact over WhatsApp.

**Every active bank account is printed, default first** — a business keeps several precisely so a
customer can pay into whichever bank they already use (§11), so printing only the default would
defeat the reason for having them. With none set up, the block is omitted rather than printed
empty.

### The letterhead is entirely optional

`Organization` gained `address`, `phone`, `email`, `taxId`, `rcNumber` and `logoUrl` on
2026-09-17, **all nullable**, decided with the owner: *"not everyone is disciplined enough to add
them."*

That is the right call and worth recording as a principle. A business that never visited a profile
screen still has to be able to invoice a customer today. Blocking the document on a required field
would make the feature useless to exactly the people it is for, so the renderer prints what it has
and silently drops what it does not — verified by a test that renders an invoice for a business
with nothing filled in and no bank accounts.

`GET /organization` is readable by every member, because a rep issuing an invoice needs what goes
on it; `PATCH /organization` is owner and manager. **`currency`, `timezone` and `nextSaleNumber`
are deliberately not editable there**: periods resolve in the timezone (§12), and rewinding the
invoice counter would hand out a number twice.

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

### Append-only feeds sync on `createdAt`; mutable ones sync on `updatedAt`

This is the rule, and getting it wrong is silent. A feed ordered by `createdAt` only ever tells a
client about rows it has never seen. That is exactly right for the stock ledger, which is
append-only: a movement is written once and never changes.

It is wrong the moment a row can change after it is written. Voiding a payment moves `updatedAt`
and leaves `createdAt` alone, so a client that had already paged past that payment would never
hear about the void — it would go on showing an invoice as settled, which is money the business
does not have on a screen nobody thinks to doubt. Deleting an expense has the same shape.

Ordering by `updatedAt` fixes it because a row only ever moves **forward** in the ordering.
Moving forward can re-send a row the client already has, which is why **clients must upsert by
id**; it cannot skip one, which is the failure that matters. A duplicate is a no-op; a missed
void is not.

`keysetWhereCreated` and `keysetWhereUpdated` in
[`keyset-cursor.ts`](../src/common/pagination/keyset-cursor.ts) name the two cases so the choice
has to be made deliberately for each new feed. Today: movements and sales are append-only,
payments and expenses are mutable. Expenses also take an explicit `includeDeleted` flag, because
a syncing device needs the tombstone while a person reading a list does not.

**Derived figures are a client-side concern.** A sale's balance changes when a payment against it
is voided, without the `Sale` row itself being touched — so clients compute balance from the
payments and returns they have synced, using the same `balance.ts` arithmetic the server uses.
That is why getting the *payment* feed right is what makes the sale's balance right.

---

## 9. Auth

### Secrets leave the database only where something asks for them by name

Added 2026-09-17 after a pre-deployment review, and this is the most serious defect the project
has had. **`GET /users/:id` had no role guard and no tenancy filter**, and returned the full user
row — argon2 **password hash**, OTP hash, last login IP — to any authenticated caller in any
organization. Reproduced against a running server before it was fixed.

**Why nothing caught it.** `User` carries `@Exclude()` on exactly those fields, so the code read as
protected. It was inert: `@Exclude()` needs `ClassSerializerInterceptor`, which was never
registered, and the rows were plain Prisma objects rather than class instances in any case. A
protection that is present in the source and absent at runtime is worse than none, because it
stops anybody looking again.

**The rule now: select, never exclude.** `PUBLIC_USER_SELECT` in `user.action.ts` is an allow-list.
A column added to the schema is invisible until somebody puts it on that list deliberately — the
opposite of how the old arrangement failed. The password hash is reachable only through
`getCredentials`, named so any second caller stands out in review. `User` cannot join
`TENANT_SCOPED_MODELS`, because a person may belong to several businesses, so scoping is applied
by hand in `list()` and `findOneVisibleTo()`.

An outsider gets **404, not 403**, so the endpoint cannot be used to discover which user ids exist.

**What guards it now**: a unit test asserting no secret is ever on the allow-list, and a smoke
check that scans **every response in the whole run** for an argon2 hash. The blunt net is the point
— the endpoint that leaked was never suspected, so the check that finds the next one must not
depend on guessing where to look.

### OTP_OVERRIDE is refused in production, not merely discouraged

Same review. `OTP_OVERRIDE` lets `npm run smoke` run unattended against a deployed test instance
with no mailbox to read, and it is also a master key into every account. §15 had recorded that as a
warning since Slice 6; a warning is not a control, and "test instance" has a way of quietly
becoming production. `auth.service.ts` now ignores it when `NODE_ENV === 'production'` and logs an
error naming it, so a copied env file fails loudly instead of opening every account.

### A cashier signs in with a username, because they have no email

Decided with the owner on 2026-09-17, building staff management. The prompt was a plain
observation about this market: **most cashiers do not have a working email address.**

Requiring one meant the owner inventing `amina@shop.local`, which had two consequences. The
verification code would never arrive, so the account could never be used. And password reset would
be permanently impossible for exactly the accounts most likely to need it.

The mistake was using one column for two jobs. **A login identifier** must be unique and typable
by somebody in a hurry. **A contact address** is where resets and receipts go. Owners have both.
Cashiers have only the first.

So `User.email` is now **nullable** and `User.username` sits beside it, with a CHECK constraint
that a row must carry at least one. Login accepts either; the failure message is identical for
both, so it cannot be used to discover which names exist.

**The username is stored qualified by the organization slug** — the owner types `amina`, the
system stores `amina@adebayo-stores`. The slug is already globally unique, so the username column
is globally unique for free and two shops can each have an Amina without anybody coordinating.

**Rejected: issuing real mailboxes on our own domain.** It was considered. Running mail means MX
records, deliverability reputation, spam filtering, storage and abuse handling — an infrastructure
project larger than the feature it serves — and it buys nothing, because a cashier does not need
to *receive* anything. They need to sign in. Synthetic addresses that look like email but never
deliver were rejected for a smaller reason: something would eventually try to send to one.

`AccessTokenPayload.email` is nullable for the same reason, and deliberately does **not** fall
back to the username. A claim named `email` carrying something else will eventually be believed by
something that sends mail.

### Staff are added by the owner, and seats are the pricing lever

Same day. Until this, a `Membership` was only ever created by registration, which makes the
*owner* of a *new* business — so the app was effectively single-user. A cashier could only
register a separate business with its own empty stock.

**The owner creates the account outright**, rather than sending an invite. Invites need email
delivery, which is the thing these staff do not have. The owner sets the password and tells them;
the account is created **pre-verified**, because the owner standing next to them is the
verification and a code would never arrive. The owner can also reset a staff password, which is
not a convenience: without it the first forgotten password is unrecoverable.

**Writes are owner-only.** A manager is a staff role like any other — they post stocktakes and
override credit sales, but hiring, firing and handing out roles is the owner's.

**`Organization.maxUsers` is a column, defaulting to 5** — one owner and four cashiers. It is a
column rather than a constant because it is a **pricing lever**: the basic tier's line will move,
and moving it must not need a migration or a deploy. Billing (slice 9) will set it per plan, and a
pilot customer can be granted more without touching code.

Three rules about it matter more than the number:

- **Checked on adding and reactivating, never on signing in.** A business that ends up over its
  limit keeps working. Locking cashiers out of a live shop over a subscription is how a customer
  is lost in an afternoon.
- **Only active members hold a seat**, so suspending somebody who left frees it immediately.
- **The number is a guess until there are customers.** If the median shop runs six people, five
  reads as punitive rather than as a natural upgrade; if it runs three, the lever never fires.
  The first ten businesses will say, and the column means you can move it when they do.

**Two guards keep a business reachable.** The last active owner cannot be demoted or suspended, and
nobody can change their own role or suspend themselves — otherwise one wrong tap leaves a business
with nobody able to manage staff. `owner` is grantable precisely so there is a way out.

**Removal is suspension, never deletion.** Their name is on sales, payments and stock movements.
It takes effect on their **next request**, because `JwtStrategy.validate` re-reads membership
status every time — not when their token expires.

**Deferred: a person who works at two shops.** An email or username already in use is refused
rather than attached to a second business. Quietly adding somebody to an organization is both a
consent problem and a way to test whether an address exists. Doing it properly needs an invite the
person accepts, which needs email, which is what this whole decision works around.

### Working hours are the shop's, and a person's only when they differ

Decided with the owner on 2026-09-18: staff should only be able to use the app during business
hours, and somebody who leaves should stop being able to at all.

**Held on the business, overridden per person** — not per person alone. Per-person-only needs a
default for a new employee and both answers are wrong: "any time" quietly exempts the newest and
least-known member of staff, "never" stops them working on their first morning. A shop sets
08:00–19:00 once and everybody inherits it, including whoever is hired next week. `opensAt` and
`closesAt` are nullable on `Membership`, and null means inherit; an empty `workingDays` inherits
for the same reason, so "same hours, Saturdays only" is `[6]`.

**Times are minutes past midnight**, resolved in `Organization.timezone`. Not a `time` column,
which would invite somebody to store an instant and bring back the 1am problem from §12.

**A window never crosses midnight**, enforced by a CHECK in the database and a friendlier message
in the service. There is no night shift yet, and that constraint is what keeps the check a single
comparison rather than two ranges — which is also why adding night shifts later is a real change
rather than a flag.

**8am–7pm is already an eleven-hour cap.** A separate maximum-duration rule was considered and
rejected: it would have to track when a session began and cut somebody off part-way through, which
is the failure mode the whole design avoids. If a genuine fatigue rule is ever wanted, it is a
different feature with a different answer to "what happens mid-sale".

**Checked when a session is issued or renewed, never on an ordinary request.** This is the
load-bearing decision. Access tokens last fifteen minutes, so somebody is locked out within a
quarter of an hour of closing and **never in the middle of recording a sale** — a half-written sale
is worse than the problem being solved, and a rule that interrupts work is a rule people route
around. Both `AuthService.issueForUser` and `TokenService.rotate` call
`WorkingHoursService.assertWithinHours`, because enforcing it at login alone would let a cashier
sign in at five to seven and work all night.

**The owner is never locked out** of their own business — they will check the day's figures at ten
at night. Everyone else, managers included, is subject to hours, with a per-person
`ignoresWorkingHours` flag for the month-end stocktake and the lorry that arrives late. That reuses
the per-person mechanism rather than inventing a second one.

The arithmetic is pure, in `staff/working-hours.ts`, beside `period.ts` and `purchase-target.ts` —
a comparison and a fallback, both easy to get subtly wrong in a timezone and both worth testing
without a database.

### Rate limiting counts people, not addresses

Changed 2026-09-17, found while answering "how many staff can be logged in at once".

The default `ThrottlerGuard` counts by IP. That is wrong for this product, and the reason is the
shape of the customer rather than anything about the code: **a shop has one router**. Four
cashiers on one counter share a public address and therefore one allowance of 120 requests a
minute, and recording a sale is several requests. A busy hour would start returning 429s that look
to staff like the app randomly breaking. Nigerian mobile networks make it worse — carriers put
many subscribers behind one address, so two reps in different towns can throttle each other.

`PerUserThrottlerGuard` keys on the signed-in user and falls back to the IP for anyone who is not
signed in. **Brute-force protection is untouched**: login, register, resend-otp and reset have no
authenticated user by definition, so they keep exactly the per-address limits they had.

Verified against a running server: one user was throttled at request 121 while a second user on
the same machine and address was unaffected. Under the old guard the second user would have been
blocked by the first one's traffic.

**This depends on guard order.** `JwtAuthGuard` is registered before the throttler in
`AppModule`, so `request.user` exists by the time the tracker runs. Registering the throttler
first would silently revert it to counting whole shops as one client — the comment in
`app.module.ts` says so, because nothing else would catch it.

Keys are prefixed `user:` and `ip:` so a user id shaped like an address cannot share a bucket
with a real one.

### Swagger defaults to off

`SWAGGER_ENABLED` defaulted to `true`, so a deploy that simply forgot the variable would publish a
complete map of the API. Defaults fail closed now; `.env.example` and the local `.env` turn it on
for development.

JWT access tokens plus refresh tokens with **rotation and reuse detection**: replaying an
already-rotated token revokes the whole token family, so a stolen copy cannot keep renewing
alongside the real user. Refresh tokens are stored as selector + hash so a row can be found
without reversing the hash.

Tokens are returned **both** as JSON and as httpOnly cookies — one code path serving Swagger, the
mobile app and a browser dashboard.

The JWT strategy re-checks membership per request, so revoking access takes effect immediately
rather than at token expiry.

Passwords use argon2. Login is rate-limited. Mail (Resend) falls back to logging codes when
unconfigured, so OTP and password-reset flows are testable without a verified sender domain —
**in development only**, see below.

### The second pre-deployment review, 2026-09-18

A sweep of the whole surface rather than of a diff, on `fix/pre-deploy-hardening`. The 2026-09-17
review looked at what had just changed; this one asked what a signed-in **cashier** can reach,
which is a different question and found a different class of problem. Nothing here was a way in
from outside — authentication, tenancy and the tenant Prisma extension all held. Every finding was
an **authenticated** caller reading or doing more than their role should allow.

**The shape of it: writes were guarded, reads were not.** Nine endpoints enforced a role on
`POST`/`PATCH` and none on `GET` beside them. That is a natural way for an API to drift — a role
gets added when a write is written, and a read added later inherits nothing — which is why the
fix is a shared constant rather than nine more decorators.

- **Cost is now redacted in one place: `src/common/authz/cost-visibility.ts`.** `SEES_COST` had
  been spelled out privately in `report.controller.ts`, so it held on `GET /reports/profit` and
  nowhere else. The same buying prices were reachable through `GET /products` (`costPrice`),
  `GET /sales` (per-line `costOfGoodsSold`), `GET /stock/levels?includeBatches=true` (per-lot
  cost), `GET /goods-receipts` (`totalCost` — the vendor's invoice itself) and `GET /reports/sales`
  (`cogs`, `grossProfit` and `marginBps` per row, which is `/reports/profit` grouped by product
  and was open to everybody). A rep who can read those can price against the house or carry them
  to a competitor, and it cannot be undone once it has happened.

  **Redaction lives at the read edge — `findAll`, `findOne` — never in the shared `include`.**
  That is load-bearing: `SaleReturnService` reads the real `costOfGoodsSold` to apportion cost
  onto returned goods and would compute against `undefined` on a redacted row. It runs its own
  query, so the presentation edge cannot reach it. A field is **removed, not zeroed**: a zero
  reads as "these goods were free" to anything that sums the column.

  **Lists stay readable, money comes off them.** The expiry list and goods receipts are withheld
  from nobody — a storekeeper walking the shelves needs to know which lots to push, and whoever
  recorded a delivery has to be able to check the quantities they typed. Only the money goes.

- **A negative payment now needs the same authority as a void** (`HANDS_MONEY_BACK`, owner,
  manager, accountant). §11 keeps a refund as an ordinary payment row with a negative amount
  rather than a second table, which is right — but it means the *route* cannot tell taking money
  in from handing it back, so the sign is checked in the service. Voiding already required those
  three; recording the negative that cancels the same invoice required nothing, so a cashier short
  in the till could balance it with a refund nobody approved.

- **A colleague sees names and roles; an owner or manager sees the record.** `GET /staff` is
  deliberately open to every member — a rep needs to know who to hand a sale to — but it was
  returning `username`, which in this product is **half of a credential**: staff sign in with a
  username because they have no address, and an owner can set their password directly. Contact
  details and each person's hours went with it. `COLLEAGUE_SELECT` is an allow-list, per the
  select-never-exclude rule above.

- **Resetting a staff password now ends their sessions**, and so does suspending them. The
  self-service path in `AuthService.resetPassword` had always revoked; the path an owner actually
  uses had not — and most staff can never use the other one. An owner resetting a departing
  cashier's password believes they have just locked that person out, and the refresh token issued
  under the old password went on renewing for seven days. Suspension was already effective (the
  JWT strategy re-reads membership per request) but is revoked too, because a suspended person
  holding a live credential is a state worth not having.

  This needed `StaffService` to reach `TokenService`, and `AuthModule` already imported
  `StaffModule` for the hours check — so `WorkingHoursService` moved into its own
  `WorkingHoursModule`. **Preferred to `forwardRef`:** the cycle was real, and a module that two
  others share is the honest description of it.

- **`switchOrganization` was a third session-issuing path with no hours check.** §9 says both
  `issueForUser` and `TokenService.rotate` must call `assertWithinHours`; this one minted a pair
  directly. Somebody working for two businesses could sign into the open one and switch into the
  closed one. **If a fourth path to `issuePair` is ever added, it needs the same line.**

- **Mail must be configured in production, and never logs the secret there.** The fallback that
  makes OTP flows testable writes the verification code and the password-reset URL into the log in
  plaintext. On a developer machine that is the point; on Render it is a full account-takeover
  path for anyone who can read the platform log, which is a wider group than it looks.
  `RESEND_API_KEY` and `MAIL_FROM` are now **required when `NODE_ENV=production`** — refused at
  boot, the same treatment `OTP_OVERRIDE` gets, because a note is not a control — and
  `MailService` logs the fact without the contents there regardless, so the guard does not depend
  on the other guard having held.

- **Moving a customer between price lists is owner and manager.** `PATCH /customers/:id` had no
  role at all, and its own summary says it is "chiefly how a customer is moved onto another price
  list, which is what decides the prices on their next sale". Creating and editing customers stays
  open — a rep meeting a new shop has to write them down — but the tier is a pricing decision
  wearing a contact-details hat, and left open a rep could move a customer to the cheapest tier,
  sell, and move them back with nothing on the record. Checked against the *current* value, so
  re-sending the same tier with a phone number change is not treated as a change.

- **Google sign-in now requires a verified address.** `googleLogin` matches on the address alone
  and links an existing password account to the Google identity, so an unverified address — which
  a Workspace domain can present — was enough to take over the matching account. Google marks it
  on the profile and nothing was reading it. Absent is treated as unverified.

- **Bounds that were simply missing.** Client-supplied `occurredAt` is essential to §8 and was
  entirely unbounded, while every report in §12 filters on it: a sale dated 2087 sits outside
  every window forever. Now within a day ahead and a year behind, with `createdAt` still recording
  when the row really arrived, so a date moved *within* that window stays auditable by comparing
  the two. Line arrays had `@ArrayMinSize(1)` and no ceiling. Money had `Min(0)` and no `Max`, and
  `unitPrice × quantity` could exceed `int4` from two individually valid inputs — caught where the
  multiplication happens, so it is a 400 naming the line rather than a 500 carrying a driver
  error. `helmet` added for HSTS and `nosniff`; CSP is off because the only HTML served is Swagger.

**What was already right, and should stay that way.** The tenant Prisma extension throws rather
than leaking when there is no organization in context; `PUBLIC_USER_SELECT` is a real allow-list;
refresh rotation revokes the whole family on reuse; the idempotency interceptor claims before it
executes and is organization-scoped. One of these is quieter than it looks: the extension does
**not** rewrite `update.data`, so nothing stops a row being moved to another organization by
passing `organizationId` in a body — what stops it is `forbidNonWhitelisted: true` on the global
`ValidationPipe`, which rejects the unknown property first. **That pipe setting is a security
control, not a tidiness preference.** The same is true of nested writes: the extension only
rewrites top-level operations, and there are none in the codebase today.

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

### Correcting a mistake is a void; correcting reality is a negative payment

These are two different facts and they get two different mechanisms. Confusing them is how a
receivables figure ends up describing something that never happened.

| | A **negative payment** | A **void** |
|---|---|---|
| Says | money moved back | the money never moved |
| Because | a refund, a bounced cheque | a mis-keyed amount, the wrong customer |
| On the bank statement | appears | never appeared |
| Effect on the row | a new row | flags the original |

`POST /payments/:id/void` sets `voidedAt`, `voidedReason` and `voidedByUserId`. The row is kept
and its allocations stay attached, so both the mistake and its correction are legible afterwards
— nothing here is ever hard-deleted. What changes is that it stops counting: the invoices it had
settled go back to being owed.

**The reason is required**, exactly as it is on a forced stock movement, and for the same
argument: a void with no reason is indistinguishable from a payment quietly disappearing, which
is the thing a reader later needs to rule out.

**A `sales_rep` cannot void.** Owner, manager and accountant can. A rep who both collects cash
and can erase the record of collecting it is an obvious hole, and correcting a collection is a
supervisor's call — which is the same shape as the negative-stock override in §5.

**Why not an editable payment.** A `PATCH` that rewrites the amount produces the tidiest
statement and the worst record: the row stops matching the bank line it exists to reconcile
against, and the original entry is gone. Voiding keeps the audit trail an append-only ledger
would give you, while still letting the customer's statement show only what really happened —
because a statement excludes voided rows (they remain on `GET /payments`).

**What counts toward a balance is one decision, expressed twice**, and both live in
[`balance.ts`](../src/modules/payments/balance.ts): `saleBalance` does the arithmetic, and
`LIVE_ALLOCATIONS` is the Prisma fragment that filters voided payments out of every query
feeding it. They sit in the same file deliberately — spread across four `include` blocks, the
fourth is the one that gets forgotten.

### A payment knows which account it landed in

Added 2026-09-17, raised by the owner. `PaymentMethod` already said *how* the money moved —
`cash`, `transfer`, `pos`, `cheque` — and `reference` held the slip number. Neither says **where**
it went, so reconciling against a bank statement meant matching on amount and date and hoping.

`BankAccount` is the set of accounts the business is paid into, and `Payment.bankAccountId` says
which one took each payment. Reconciliation is then a join: pull one account's statement, lay it
beside the payments recorded against that account over the same dates, and the two either agree or
name their difference.

**Several accounts is the normal case, not the exception.** The owner reports businesses running
as many as five — one per bank their customers already use, so a transfer is free and instant for
the payer, plus a separate account for POS settlement. So this is a collection with a default
rather than a field on `Organization`.

**`transfer` and `pos` must name an account; `cash` must not.** A POS terminal settles into a
specific account, so it reconciles exactly as a transfer does. Cash never touched a bank, and
letting it claim an account would put money in a statement line that will never exist. A cheque is
left optional — it is written today and banked whenever, so the account is not known when the row
is recorded.

**The account is never defaulted for a caller who did not choose one.** Silently picking the
default would record money into an account it may never have reached, and the error only surfaces
at reconciliation, by which time nobody remembers which transfer it was. A 400 that names how many
accounts there are to choose from is cheaper than a mismatch found a month later.

**The consequence is that a business must set its accounts up before recording its first
transfer.** Taken deliberately: if you are accepting transfers, you have an account. The error
names `POST /bank-accounts` so the fix is obvious.

**An account with payments against it cannot be deleted**, only marked inactive. Deleting it would
leave those payments unable to say where the money went, which is the single question the model
exists to answer. `isActive` already stops it being offered for new money.

`GET /reports/collections` gains a **per-account breakdown** alongside the per-location one. The
location grouping is the end-of-shift cash-up; this one is the reconciliation view. Cash gets its
own row rather than being dropped, for the same reason payments with no location do.

Worth noting for later: **Paystack and other gateways are not this.** Adding one to the enum would
be one line and misleading — a gateway deducts a fee, settles a day or two later, and should
create the payment itself from a webhook rather than being typed in. Recording `paystack` as a
label is honest; an integration is its own slice.

### A payment knows which counter took it

`Payment.locationId`, set automatically when a sale banks its own payment — the counter that rang
it up is the counter that took the cash, so the end-of-shift cash-up needs no extra input from the
person selling. Optional on a standalone payment, because a transfer landing in the bank belongs
to no till.

`GET /reports/collections` groups on it, which is the cash-up. Payments with no location are
reported under their own row rather than dropped or forced onto one: "not at a counter" is a real
category, and hiding it would make the tills fail to add up to the total.

Added before there were rows worth backfilling. Without the column the question is not merely
hard, it is unanswerable from the data — and it is the first thing anyone asks the day two people
are collecting money.

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
miscellaneous — through the same `seedOrganizationDefaults` both registration paths call (§13).
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

## 12. Reports

### Computed on read, until something is slow

Nothing is materialised, cached or rolled up nightly. Every report is an
aggregation over rows that are already correct, and a stored summary is a second
source of truth that can drift from the first — which is the bug nobody notices
for a month.

The honest position is that nobody knows the row counts yet. Compute on read, and
let the first genuinely slow query be the evidence that changes it. The
containment is that the arithmetic lives in pure modules, so moving where it runs
does not mean rewriting what it computes.

### Revenue is tax-exclusive, and this is the number that surprises people

Prices are stored VAT-inclusive (§2), so an invoice total contains money that was
never the business's. Counting the gross as revenue overstates **every** margin by
the VAT rate:

```
₦120,000 sale, ₦80,000 cost, 7.5% VAT inclusive
  naive:    (120,000 − 80,000) / 120,000        = 33.3%
  correct:  (111,627.91 − 80,000) / 111,627.91  = 28.3%
```

Five points of margin that do not exist, on every line, forever. `Sale.taxTotal` is
frozen on the row, so the subtraction is exact rather than re-derived.

This also means **the dashboard will read lower than the owner expects**. That is
the report working.

### A return counts in the period it happened

Not the period of the sale it reverses. Restating a month that has already been
read, acted on and possibly paid tax on is what accounting does, and this is
deliberately not accounting (§1). A month with only returns in it goes negative,
which is a true statement about that month.

### Profit is a management figure, not a P&L

Revenue − cost of goods = gross profit. Minus expenses = operating profit. There
is no depreciation, no accruals, no allocation of overhead to products, and no
attempt to be defensible to a tax authority. It answers "did I make money this
month", which is the question actually being asked.

### Sales and collections are two numbers, and the gap is the point

The dashboard reports what was sold and what was actually received as separate
figures. On a credit route they diverge constantly, and conflating them is how a
business reads a strong month while running out of cash. Anything else on that
screen is arithmetic; this pair is the insight the product exists to deliver.

### Periods are resolved in the organization's timezone

Rows are UTC instants; an owner asks about a day in Lagos. Bucketing on the UTC
date files every sale made between midnight and 1am WAT under the previous day —
so "today's takings" is wrong for the first hour of every day, and the daily chart
is silently shifted. `Organization.timezone` exists for exactly this.

All of it lives in [`period.ts`](../src/modules/reports/period.ts) and nothing
outside that file does date arithmetic. Ranges are **half-open** (`from` inclusive,
`to` exclusive) so consecutive periods tile without double-counting midnight, and
the offset is resolved in two passes so a tenant in a DST zone is not a future bug
report.

### Stock is valued from lot totals, never from `costPrice`

`onHand × (batch.totalCost ÷ batch.quantityReceived)`, summed, and **rounded once**
at the end. Rounding each lot first lets the error grow with the number of lots in
the building — there is a test showing ₦3.33 of drift from a thousand lots alone.
`Product.costPrice` is a rounded display snapshot and §2 forbids it as an input.

Free goods need no special case: a free carton raises `quantityReceived` without
raising `totalCost`, so every unit in that lot is worth slightly less, which is
what actually happened.

Group subtotals each round their own fractions, so they will not always add to the
grand total to the kobo. The grand total is valued over every lot at once, and a
screen showing both must take it from there rather than summing the groups.

### Reorder points are per product, in base units

Below this level, the dashboard asks for it. `NULL` means nobody set a level and
the product is left off the low-stock list entirely — deliberately different from
`0`, which means "tell me the moment it runs out". The list also reports how many
products have no level, so it is never mistaken for complete.

Quantities are summed **across locations**, because the level is per product: an
empty van is not a reason to reorder when the store is full. Per-location levels
were considered and rejected for now — they need a table and a setup step before
a single alert works, and nobody has yet asked for a van to reorder itself.

### Reps do not see cost

Margin, cost of goods and stock valuation are restricted to owner, manager and
accountant. A `sales_rep` carrying buying prices around a market is a commercial
problem rather than a permissions technicality, and it cannot be undone once it
has happened. Reps keep the reports that expose no cost: what sold, and to whom.

### Vendor purchase targets: received, paid for, and counted once

Built 2026-09-16, closing most of §15 item 3. A target is the vendor's monthly offtake quota —
"110 cartons of lotions" — and the question it answers is how far off the pace the month is.

**Progress counts goods received, never orders placed.** There are no purchase orders (§6), and
an order the vendor has not delivered is precisely what still needs chasing, so it belongs in
"remaining" rather than in progress. `GoodsReceiptLine` is the row that is summed.

**Quantities come from `quantityPaidFor`, not `quantityReceived`.** "Buy 19, get 1 free" advances
a 110-case target by 19. The free case is real stock, absorbs into cost per §2 and counts for
valuation — it simply does not advance a quota the vendor wrote in cases they sold.

**Value comes from `GoodsReceiptLine.totalCost`**, never `costPrice × quantity`, which §2 forbids
as an input.

**The rollup subtracts rather than sums.** A category target covers only the products in that
category that carry no target of their own. A vendor quotaing both "lotions" and one lotion SKU
would otherwise see that SKU's cartons advance both rows, and our number would read comfortably
ahead of a quota nobody had met. The arithmetic is pure, in
`src/modules/reports/purchase-target.ts`, beside `period.ts` and `profit.ts`, because the rule
that is easy to get wrong here is a subtraction rather than a query.

**Quantity converts on write**, with `unitFactor` captured at that moment — the same rule
receiving follows, so redefining a carton next year cannot silently restate a quota agreed in
cartons of twenty-four. `displayUnitId` remembers what the owner typed, so "110 cartons" reads
back as cartons.

**The period is a calendar month in `Organization.timezone`**, snapped through `period.ts`. The
vendor's scheme runs on months, not a rolling thirty days.

**~~Targets are not on `GET /reports/dashboard`, deliberately.~~** — **the premise was wrong, and
this was corrected on 2026-09-19.** `targetValue` is a buying price in all but name, which is
right; the rest of the reasoning said the dashboard is the rep's home screen and so one payload
could not serve both audiences without stripping fields per role.

**The dashboard has been `@Roles(...SEES_COST)` for some time.** Reps cannot reach it at all, so
there were never two audiences to serve and nothing needed stripping. The rationale had outlived
the condition that produced it, and while it stood it argued against a change that was in fact
safe — which is how §16 came to put payables and purchases straight onto the dashboard with no new
mechanism.

Worth keeping as a general lesson: **a stale rationale costs more than no comment**, because it is
read as a decision somebody already thought through. When a comment explains why something is
unsafe, check the condition still holds before building around it.

**A target cannot change what it is set against.** Rewriting a lotions target into a roll-on one
would silently restate what last month's number meant; delete it and set the one that was agreed.

---

## 13. Traps already hit

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
| **A unique constraint over a nullable column** | `PurchaseTarget` sets exactly one of `categoryId` / `productId`, so `@@unique([org, supplier, periodStart, categoryId, productId])` looks right — and is useless. Postgres treats NULLs as **distinct**, so two identical category targets, both carrying `productId` NULL, do not collide. A duplicate does not error; it silently doubles that target's reported progress, which reads as being ahead of a quota nobody met | Two **partial** unique indexes hand-written in the migration, one per scope, both excluding soft-deleted rows. Prisma cannot express a partial index, so they live in SQL — and `migrate diff` was checked afterwards: it returns an empty migration, so Prisma leaves them alone rather than proposing to drop them |
| **Hashing a request that has no body** | A command route carries no body, so nothing sets a JSON content type and Express leaves `req.body` **undefined**. `JSON.stringify(undefined)` is the *value* undefined rather than a string, so the hash threw: every request sending an `Idempotency-Key` to `POST /stocktakes/:id/post` answered **500**. Found by `smoke.mjs` the first time a key was ever sent to that route — the unit tests only ever hashed `{}` | `body ?? null` in `hashBody`, and a test for the undefined case |
| **An idempotency key scoped to the route *pattern*** | `POST /stocktakes/:id/post` hashed identically for every count — the pattern is the same string and the route carries no body — so one key reused across two counts would have matched the first, replayed its response, and **posted nothing** while returning success. In practice it never got that far: the missing-body crash above answered 500 first. Two bugs stacked, and the outer one hid the inner one | The stored `endpoint` is now `method + the concrete URL`. A retry always goes back to the same address, so nothing legitimate is lost by being specific |
| **Recording an idempotency key *after* the handler** | `tap` fired once the work was done, leaving a window where two overlapping requests both found no key and both executed — precisely the client-times-out-and-retries case the feature exists for. The unique constraint then kept one key row while two sales existed | The key is **claimed before** the handler runs, so the constraint picks one winner; the loser gets a 409 saying the first is still in progress. A handler that throws deletes its claim, or a failed request could never be retried |
| **`npm audit fix --force` is not the only tool** | Every advisory left open in §15 item 14 was against a **transitive** package, and the item concluded they needed a NestJS major and a Prisma release. They did not: `npm audit fix --force` can only bump the *parent*, which is why it proposed NestJS 12 and a Prisma **downgrade**. npm `overrides` pins the transitive package directly and left both majors alone. Nine advisories had been deferred on reasoning that was careful and simply reached for the wrong instrument | Three lines of `overrides` in `package.json` took the audit to **0 vulnerabilities** on Prisma 7 and NestJS 11. When an advisory is transitive, try `overrides` before concluding a major upgrade is required |
| **Redacting a field the write path still reads** | Removing `costOfGoodsSold` from a sale looks like a `select` change — until `SaleReturnService` reads it off a sale line to work out how much cost comes back with returned goods. Done in the shared `include`, every return would have apportioned cost against `undefined` and written `NaN`, silently, on a path no test covered | Redact at the **read edge** (`findAll`, `findOne`) and never in the `include`. Internal callers run their own queries, so the presentation edge cannot reach them. The same reasoning says remove the field rather than zero it: a zero is read as "free goods" by anything that sums it |
| **A smoke suite that only passes during business hours** | `npm run smoke` died at step 39 on a 403 from `POST /auth/login` — the **working-hours rule doing exactly its job**. A new organization defaults to 08:00–19:00, and every cashier sign-in after that point in the script inherits it, so an evening run failed on a feature that was working. The abort message named the window, which is the only reason it took minutes rather than an hour | The staff section now PATCHes the org to `opensAt: 0, closesAt: 1440` before the first cashier signs in. Nothing is weakened: the working-hours section further down still shuts the shop explicitly to test the refusal |
---

## 14. Where things stand

**Slices 0–6.6 done, plus the 6.1 gap-closing pass, two security passes, and staff
management and working hours. On the web side, 7.0 through 7.6a are done — a sale can be rung up
in a browser, and the sales, money, catalog, stock and report screens are live. Only 7.6b,
settings, stands between here and v1.** 445 tests across
34 suites, twenty-four migrations, `typecheck`/`lint`/`build` clean in both trees, `npm audit` at
**0 vulnerabilities**, and `npm run smoke` green at 369 checks against a running server.

**Slice 7.6a — reports — landed 2026-09-26**, recorded in §17. It typed the seventeen remaining
report and purchase-target endpoints, and collapsing a duplicated row type found a latent `NaN`:
`MoverRow.cogs` was declared required while the value behind it comes from a redacted path. The
general lesson is worth keeping — **a duplicated type is a second chance to be wrong, and the copy
is the one nobody re-checks.**

**Slice 7.5b — stock — landed 2026-09-26**, recorded in §17. It typed the whole inventory module,
which had been returning `content?: never` on every endpoint, and closed two gaps that only a
screen would have found: **`GET /stock/movements` was sync-only** — the fourth feed to need a
browsing walk, which makes the pattern a checklist item rather than a discovery — and
**`GET /goods-receipts` was unbounded**, returning every delivery ever recorded with every line
on each.

**Slice 7.5a — the catalog — landed 2026-09-26**, recorded in §17. It fixed a silent no-op worth
knowing about: **`PATCH /products/:id` accepted a `units` array and wrote nothing**, answering 200.
Units now upsert by name like prices, with three limits — nothing is deleted, `factor` may change
because dependent rows snapshot it, and the base unit cannot move because stock is counted in it.

**Slice 7.4 is complete — money in landed 2026-09-26, money out the same day**. §17 records both.
The rule from 7.4b worth repeating here: **the vendor side is not the customer side mirrored.** One
vendor payment settles exactly one bill, there are no negative payments, and overpaying is a 409
rather than credit — three absences a later change could undo without noticing they were decisions.

**Slice 7.4a — money in — landed 2026-09-26**, recorded in §17. One rule from it is general enough
to belong here: **the one-second sync lag is a safeguard for a forward-walking cursor, and a
browsing reader must skip it.** Leaving it on made a payment recorded a moment earlier vanish from
the list that refetched, which reads as a lost payment. The same latent bug was in `GET /sales` and
is fixed in both.

**Slice 7.3 landed 2026-09-25**, recorded in §17. The one API change it needed is worth knowing
here: **`GET /sales` serves two readers now**, a syncing client walking forward and a person
browsing backward, split by `order` which defaults to the sync behaviour. The till's other lesson
repeats — the fiddly rule in this slice is that a **damaged return refunds money but writes no
stock movement**, so crushed goods never become sellable again.

**Slice 7.2 — the till — landed 2026-09-25**, decided and recorded in §17. Scan or search into a
cart, unit and price editing, customer, payment, receipt, and dialogs for both overridable 409s.
Two things from it belong here rather than only in §17:

- **A third cost leak, on an endpoint §9 had already swept.** `GET /sales` redacted
  `costOfGoodsSold` per line and handed over the header `costTotal`, which is those same numbers
  summed — the margin, to a `sales_rep`, beside the price they sold at. Fixed in `forReading` and
  verified live as a rep. It survived because **the test's fixture never carried the field it was
  asserting the absence of**, which is worth checking in any redaction test.
- **The `Idempotency-Key` is bound to a hash of the request body.** A retry that adds a reason is a
  different body and is correctly refused as a mismatch. What makes two attempts one sale is the
  **client-supplied `id`** (§8), not the key — the till mints its sale and line ids once per cart
  and a fresh key per attempt.

**Slice 6.6 — vendor payables — landed 2026-09-19**, decided and recorded in §16. It is the door §6
left open: "what do I owe this supplier" became a question the owner actually asked, so vendor
bills came back *beside receivables* rather than as the purchasing slice that was cut. `GET
/payables` mirrors `GET /receivables`, one total that a click drills into. Two things about it are
easy to get wrong later: **an opening balance must never create stock** — the goods behind it were
received and largely sold before the row was typed, and movements for them would break the
ledger-sums-to-levels invariant — and **a supplier payment must never be recorded as an `Expense`**,
because stock already reaches profit through cost of goods sold and logging it twice understates
every margin.

**One thing about running smoke twice.** Login is throttled at five attempts a minute per address
and the staff step spends all five. Running smoke again inside that minute fails with a 429 on
login — the rate limiter working, not a flaky suite. Wait a minute between runs.

**A second pre-deployment review on 2026-09-18 swept the whole surface**, on
`fix/pre-deploy-hardening`, and closed everything it found. The decisions are in §9; the summary is
that nothing let an outsider in — authentication, tenancy and the tenant extension all held — and
**every finding was an authenticated cashier reading or doing more than their role allowed**. The
pattern was one thing repeated: **writes were guarded and the reads beside them were not**, on nine
endpoints. Buying prices in particular were closed on `GET /reports/profit` and open on five other
routes, including `GET /reports/sales`, which is the same margin figure grouped by product. Cost
redaction now lives in one shared place, `src/common/authz/cost-visibility.ts`, so the next report
written cannot quietly disagree with the last. §15 item 14's nine dependency advisories were closed
in the same pass, with `overrides` rather than the major upgrades that item had assumed.

**There is no cap on how many people may be signed in**, per user or per organization — nothing in
the code counts seats or concurrent sessions, and `RefreshToken` is indexed on `userId` rather
than unique, so one person may hold several sessions at once, on a phone and a tablet and the web.
Sessions end only on logout, a password change, or refresh-token reuse detection. The practical
ceiling is the database connection pool, not sessions.

**Staff management landed 2026-09-17** and closed what had been the largest gap: until then a
`Membership` was only ever created by registration, so the app was effectively single-user.
`/staff` now lets an owner add, re-role, suspend and restore people, and reset their passwords.
The decisions are in §9 — the ones worth knowing are that **a cashier signs in with a username
because they have no email**, and that `Organization.maxUsers` (default 5) is a **column, not a
constant**, because it is the subscription's pricing lever.

**A pre-deployment security review on 2026-09-17 found one serious defect and four smaller ones**,
all fixed on `fix/security-hardening`; the decisions are in §9 and the one deferred item is §15
item 14. The serious one — `GET /users/:id` returning password hashes to any caller in any
organization — is the reason §9 now says **select, never exclude**.

**Bank accounts landed 2026-09-17** — `BankAccount` and `Payment.bankAccountId`, decided in §11.
Additive: the column is nullable, so nothing written before it is invalidated. It exists so a bank
statement can be reconciled against payment rows by joining rather than by eye, and it is also the
join the planned statement-parser project will need.

**PDFs landed 2026-09-17, which completes Slice 6.5** — `GET /sales/:id/invoice.pdf` and
`GET /customers/:id/statement.pdf` in `src/modules/documents/`, plus the optional letterhead on
`Organization` and `GET`/`PATCH /organization` to set it. The decisions are in §6. Bank accounts
were deliberately built first, because the "pay into" block is most of why a customer wants the
invoice as a document at all.

**The backend is now feature-complete for v1.** What remains before the web dashboard is
**deployment** (§15 item 1) — and the targets chart, which §15 item 3 says can wait for the
mobile slice.

**Vendor purchase targets landed 2026-09-16** — the model, the CRUD and
`GET /purchase-targets/report`, decided in §12 and closing most of §15 item 3. What remains of
that item is the **chart**, which can wait for the mobile slice. `PurchaseTarget` lives in
`src/modules/reports/`, the only writes in a module that is otherwise reads-only, because a
target is meaningless apart from the report that measures it. The rollup arithmetic is pure, in
`purchase-target.ts`, with eleven tests on the subtraction alone.

**PDFs are the other half of 6.5 and are not started.**

**Prices and barcodes moved into the product payload on 2026-09-16** — the decision is in §4,
and it closed §15 item 10. `POST /products/:id/prices` is **gone**; `POST /products/:id/barcodes`
stays. No migration: `ProductPrice` and `ProductBarcode` already existed, so this was DTO and
service work. `ProductService.create` now runs in a transaction, because the prices and barcodes
are keyed by unit name and the ids to map them onto are minted by the same statement.

This is the **last breaking change planned before the web dashboard**. It was taken first
deliberately: a product form written against the old shape would have had to be rewritten, and
everything else outstanding — vendor targets, PDFs, deployment — is additive to what a client
already sees.

**Idempotency was rebuilt on 2026-09-16** after three holes turned up while documenting it, all
recorded in §13. The key is now claimed *before* the handler runs rather than recorded after; its
identity is the concrete URL rather than the route pattern; and `hashBody` no longer throws on a
request with no body.

Seven tests were added for the interceptor, which until now had none, plus one for `hashBody` —
the only part that was covered, and only ever with `{}`, so none of the three holes had anything
watching it. The fake Prisma table in that spec enforces the unique constraint *synchronously* on
purpose: one that checked after an `await` would let both racers through and prove nothing.

**The third hole is the one worth remembering, because of how it was found.** `smoke.mjs` step 38
now posts two different counts with one key and expects the second refused. Adding that step sent
an `Idempotency-Key` to `POST /stocktakes/:id/post` for the first time ever — and got a 500. The
route had been decorated since Slice 6.1 and documented in Swagger as accepting the header, and
any client that had taken that at its word would have got a 500 too. Nothing in the unit suite
could have caught it: the crash needs a real Express request with no content type, and a mocked
request object always has whatever body the test wrote. That is the case for keeping smoke.

Note also that the second hole was **unreachable behind the third** — the crash fired before the
replay could. Fixing the visible bug first would have quietly re-armed the silent one.

Slice 6.1 (2026-08-31) closed five of the gaps recorded in §15, in this order:

1. **Delta sync on mutable rows.** Payments and expenses now page by `updatedAt`, so a void or a
   deletion reaches a client that had already synced the row — see §8. Expenses joined the sync
   path at the same time, with an explicit `includeDeleted` for tombstones.
2. **`Payment.locationId`**, and `GET /reports/collections` grouping on it: the end-of-shift
   cash-up (§11).
3. **The no-further-credit rule** (§6). Not a credit limit — the owner confirmed the product does
   not extend credit as a matter of course, so an unsettled balance gates the next credit sale,
   overridable by an owner or manager with a recorded reason.
4. **Product images** (§4): `imageUrl`/`imagePublicId`, an upload endpoint, and an honest 503 when
   image hosting is unconfigured — which is every development machine.
5. **Stocktake** (§5): `Stocktake` and `StocktakeLine`, counting separated from posting, posting
   restricted to owner and manager.
6. **Cost when the paperwork is late** (§2): a forced shortfall is priced from the product’s last
   real delivery instead of at zero, and the line is flagged `costIsEstimated` so the profit report
   can say how much margin rests on a guess. Raised by the owner from the equivalent Excel
   problem; the residual gaps are §15.

`CloudinaryService` had been dead code since Slice 2; the image work is the first thing to use it.

Slice 6 (reports) added `src/modules/reports/`: three pure modules — `period.ts` (timezone-aware
windows), `profit.ts` and `valuation.ts` — under a `ReportService` and a `DashboardService`, plus
`Product.reorderPoint`. It writes nothing; every endpoint is a read. The decisions are in §12.

`GET /reports/dashboard` is one call by design — a rep on a phone pays a round trip per request,
and nine of them feels broken long before it is slow. `ReceivableService` is reused rather than
reimplemented, so the dashboard and the receivables screen cannot disagree.

Two follow-ups from Slice 5 were closed straight after it: `.gitattributes` now pins line
endings (see §13), and a payment can be **voided** — the decision is in §11. Voiding was added
rather than an editable payment, and rather than leaving an offsetting negative row as the only
correction.

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
link to a real vendor from day one, and so the monthly purchase targets in §15 have their anchor.

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

Verified against a running server, not just compiled. Slice 6.1's checks:

- a client checkpoints the payment feed, a payment is voided, and **the void comes back on the
  next `since=` pull** — the regression the `updatedAt` ordering exists for
- a deleted expense reaches a syncing client as a tombstone, while the totals go on ignoring it
- a counter sale banks its payment at the counter that rang it up; the cash-up separates money
  that never touched a till, and every location adds back up to the total collected
- a customer who owes nothing can take goods on credit; a second credit sale is refused while the
  first stands; the same customer can still buy for cash; an owner overrides with a reason that is
  kept on the sale
- a product can point at an image hosted elsewhere; uploading with no image hosting configured is
  a 503 that names the variables to set
- **recording a count leaves stock exactly as it was** — the whole point of separating counting
  from posting — and posting then moves it, writes `count_correction` movements that appear on the
  audit report, and refuses to post twice
- a sale forced through before its delivery was recorded is **no longer costed at zero**: it
  borrows the rate from the last real lot, is flagged as estimated, and the profit report says how
  much of the month rests on that guess
- after all of that, **the ledger still sums to what the levels say**: the suite's oldest
  invariant, re-checked once corrections have been posted through it

Slice 6's checks — and the load-bearing one is **reconciliation**, the analogue of the ledger-sum check below: a report that quietly
disagrees with the rows it summarises is this slice's failure mode, and nothing else catches it.

- the profit report's gross sales equal the sum of the invoices from `GET /sales`, and its
  revenue equals those invoices less their frozen VAT, less the refund net of *its* VAT
- the dashboard's sales, revenue, receivables and operating profit each equal what the
  corresponding endpoint returns — `/reports/profit` and `/receivables`
- collections equal the sum of every payment that stands, and **exclude the voided one**; sales
  and collections come back as different numbers, which is the pair the screen exists to show
- stock valuation covers exactly 134 base units — the same figure step 19 proves the ledger sums
  to — and carries the van's −48 as negative value rather than clamping it
- nothing is flagged low until a `reorderPoint` is set; setting one to 200 puts the product on
  the list at 134 units, summed across both locations rather than per location
- sales grouped by product still total the invoices; a service line shows no cost of goods;
  walk-ins group separately from the account customer
- expiry lists the dated lot with value at risk, in the order FEFO would take it
- a second organization's dashboard is zeros, and its stock valuation is empty

Slice 5's checks:

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
- voiding a payment keeps the row, its reason and its allocations, puts the invoice it had
  settled back on the receivables list, removes the credit it had created, and drops it off the
  customer's statement; voiding twice is a 409 and voiding without a reason is a 400

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
as email registration — which is the §13 trap that put it there — so the location is seeded by
construction, but no OAuth round trip was performed.

**Not verified by hand either**: that a `sales_rep` is refused the void route. The guard is the
same `@Roles` one every other restricted route uses and the smoke script has no second user to
sign in as, so it is covered by construction rather than by demonstration.

---

## 15. Next

**The immediate next thing is slice 7.6b** — settings: the organization letterhead, staff and
working hours. It is the last slice of the web dashboard, and v1 is closed when it lands; then
the deploy at item 1 below. The slice table and
what each one owes are in §17; this list is everything that sits outside it.

**A till cannot sell half a carton, and mostly it should not have to.** Found while testing 7.2 on
2026-09-26: typing `0.5` into the quantity field is refused, at three layers — `step=1` in the UI,
`@IsInt() @Min(1)` on the DTO, and `quantity Int` in the schema. `POST /sales` answers 400.

**That is the right answer for a packaged product and the wrong one for a divisible one**, and the
difference is worth stating before anybody reaches for a migration:

- **A 12-pack carton is already half-sellable.** Stock lives in base units (§2), so half that
  carton is exactly six pieces — switch the unit on the line and enter 6. The unit picker is the
  mechanism, and nothing needs to change but making that obvious on the screen.
- **What the unit switch does not settle is the price**, which is the real question hiding in the
  request. Six pieces at the piece price is *not* half the carton price, because a carton is
  cheaper per piece — that is the entire reason `ProductPrice` is keyed by unit (§4). So "half a
  carton" is ambiguous about what to charge, and the price override is how a seller answers it.
- **Genuinely divisible goods are a catalog question, not a schema one.** Rice by the kilo, oil by
  the litre: define the base unit as the kilo and the bag as a unit with `factor: 25`. Half a bag
  is then 12.5 kg, which is still not an integer — but 12500 g is, and choosing the base unit
  fine enough is the cheap, correct answer.

**Making `quantity` decimal is the expensive answer and probably the wrong one.** It is a migration
across `SaleLine`, `StockMovement`, `GoodsReceiptLine`, `SaleReturn` and the stocktake tables, it
puts a non-integer into the ledger the smoke suite's sum-check relies on, and it invites
floating-point into a codebase that has kept money and quantities integral on purpose. Revisit only
if a real shop sells something no base unit can express.

**What to actually build, when it is worth a slice:** let the till accept a fraction in a
non-base unit, convert it to base units itself, and say what it did — "0.5 carton = 6 pieces at the
piece price" — refusing the ones that do not land on a whole base unit. That is a till change, not
a data change.

Left behind by 7.3, neither blocking:

- **`DebtorGroup` and the dashboard's `DebtorRow` describe the same rows.** Compiler-checked
  against each other, so they cannot drift silently; collapse them when 7.6 touches reports.
- **Sale detail re-fetches the whole sale after a return.** The response already carries it, and
  it does get used — but the receivables and sales caches are invalidated by key rather than
  updated, so a busy list refetches. Fine at a shop's scale.

Two small things 7.2 left behind, neither blocking:

- **`GET /sales/:id/receipt` is fetched after `POST /sales`**, a second round trip for a payload
  the sale response almost contains. Fine on a shop's wifi, worth collapsing if a till ever feels
  slow — the receipt is deliberately its own narrow shape, so the fix is to return both rather
  than to widen one.
- **The till guesses which 409 it is from the message text.** Credit is matched on its wording and
  everything else is treated as a stock shortfall. A machine-readable code on the server would end
  the guessing; a wrong guess currently costs a clear refusal rather than a wrong sale, which is
  why it was not worth a response-shape change mid-slice.

0. **Rate-limit state is in memory, and that becomes wrong the moment there are two instances.**
   The only finding from the 2026-09-18 review left unfixed, because there is no fix worth making
   yet. `ThrottlerModule` keeps its counters in the process, so limits reset on every restart —
   which on Render's free tier means every cold start after idle — and two instances would each
   allow the full five login attempts a minute. On one free-tier instance this is close to
   harmless and a Redis dependency to solve it would be the largest piece of infrastructure in the
   project.

   **Revisit when the service is scaled past one instance, and treat that as a blocker for
   scaling rather than a follow-up.** `@nestjs/throttler` takes a storage adapter, so the change
   is a provider and a connection string, not a rewrite.

1. **Deploy to Render**, free tier, decided 2026-08-30 — before buying a domain, since
   `*.onrender.com` is a working URL and a domain is a rename rather than a prerequisite. Planned
   but not built: a version-controlled `render.yaml` (web service + Postgres, region **Frankfurt**
   as the closest to Lagos), build `npm ci && npx prisma generate && npm run build`, start
   `npm run db:deploy && npm run start:prod` — migrations on boot, since `migrate deploy` is
   idempotent and the free tier has no pre-deploy hook — and the existing `/api/v1/health` as the
   health check.

   Four things already known about it:

   - **`NODE_VERSION` must be pinned.** There is no `engines` field in `package.json`.
   - **`?connection_limit=5` on the database URL.** Prisma sizes its pool from CPU count and will
     exhaust a free Postgres's connection cap.
   - **`OTP_OVERRIDE` (already in `env.ts`, honoured at `auth.service.ts:392`) makes smoke run
     unattended against Render** — no Resend account, no log scraping, since `smoke.mjs` cannot
     read a `server.log` that lives on someone else's machine. ⚠️ **It is also a backdoor into any
     account.** Long random value, test instance only, and never on an instance holding real data.
     "Test instance" has a way of quietly becoming production.
   - ~~**Free tier means ~30–50s cold starts**~~ — **superseded 2026-09-19: deployment will be on
     a paid tier.** That removes cold starts, the expiring free database, and the warm-up request
     smoke would otherwise need. It also removed the original argument for the dashboard being a
     static site, which is why §17 records the framework choice on its remaining merits rather than
     on hosting cost. Everything else in this item still applies — `NODE_VERSION` pinned,
     `?connection_limit=5`, migrations on boot, `/api/v1/health` as the health check.

     Two things change with a paid tier and are worth deciding at deploy time: the plan named
     **Frankfurt** as the region closest to Lagos, which is worth re-checking now that cost is not
     the constraint; and `OTP_OVERRIDE` remains **test-instance only** regardless of tier, because
     it is a master key into every account and paying for the instance does not change that.

2. **Slice 6.5 — vendor purchase targets and PDFs.** The targets are the spec below: a new model
   with the rollup rules, which is why they were split out of Slice 6 rather than bolted on. The
   **PDF invoice and customer statement** land with them (§6) — same rendering dependency, and the
   statement is the artifact that makes chasing a debtor over WhatsApp work.

3. ~~**Vendor purchase targets**~~ — **model and report done**, 2026-09-16; the **chart is still
   outstanding** and can land as late as the mobile slice. The decisions below were all
   implemented as written; what they became is in §12. What is left of this item is the donut or
   stacked bar, and one thing the build added rather than decided: **category targets cover the
   named category only, not its children** (owner, 2026-09-16). The owner's targets are leaf
   categories, and rolling up a tree would mean excluding a product target from every ancestor
   above it — a second subtraction nobody has asked for. It can be added without a schema change.

   (model and chart both in the reports slice — moved out of the cut
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

4. ~~**`.gitattributes`** for line endings~~ — **done**, 2026-08-30. `* text=auto eol=lf` plus
   the usual exceptions. It cost nothing: `git add --renormalize .` against existing history
   produced no diff, because `core.autocrlf=true` on this machine had been storing LF all along.
   That is precisely why it had to be pinned in the repo — the policy was one machine's local
   config, and it does not travel with a clone.

5. **Smaller things noticed while building payments.** All closed in 6.1 except the first, which
   is deliberately still open:

   - `ReceivableService.outstanding` loads every sale for the organization and computes balances
     in memory. **Deliberately left alone on 2026-08-31**, and worth writing down why, because it
     looks like an obvious cleanup:

     It is correct, and there is no evidence it is slow — §12 says compute on read until something
     *is* slow, and nobody has measured anything. More importantly, the rewrite would move balance
     arithmetic into SQL, giving this system **two implementations of what a sale still owes**.
     That is precisely the failure §11 warns about: the void filter, the returns netting and the
     sign handling would all have to be re-expressed and kept in step with `saleBalance` forever,
     and the first divergence would show up as a dashboard quietly disagreeing with the
     receivables screen it links to.

     The trigger to revisit: a real organization with enough invoices that the query is measurably
     slow. Then the right move is probably a narrowing `where` that still feeds `saleBalance`, not
     a SQL reimplementation of it.

   - ~~Expenses are not on the delta-sync path~~ — **done**, §8.
   - ~~A void does not reach delta sync~~ — **done**, §8. Both feeds now page by `updatedAt`, and
     smoke proves the void comes back to a client that had already synced the payment.
   - ~~`Payment` carries no `locationId`~~ — **done**, §11.

6. **Cost when the paperwork is late — what is still open.** §2 now estimates rather than costing
   at zero, which stops cost disappearing permanently. Three related problems remain, and they are
   worth understanding together because they all come from the same habit:

   - **The silent case.** If the *old* lot still shows stock, a sale of newly arrived goods is
     costed at the old rate with no error, no flag and nothing to see. Unlike the forced case there
     is no shortfall, so nothing marks it. Aggregate cost is still right — the old lot is depleted
     at its own rate and the new one arrives at its own — but **the attribution is wrong**: this
     month's margin is overstated and a later month's understated. On a 2–3% margin that is the
     whole signal. There is no way to detect it from the data; only recording deliveries promptly
     prevents it.
   - **Placeholder batches are never reconciled.** A forced shortfall leaves a batch sitting at a
     negative quantity forever. The real delivery arrives as a *separate* lot, so the two never
     meet. Worth a routine that matches a placeholder against the next receipt of the same product
     and location, and closes it out.
   - **Valuation ignores them.** `unitCost` returns 0 when `quantityReceived` is 0, so a negative
     placeholder contributes nothing to stock value rather than reducing it. Small, and consistent
     with not knowing the cost, but it means valuation and the ledger disagree slightly whenever a
     forced sale is outstanding.

7. **A "not sellable" flag on `ProductUnit`.** Raised 2026-08-31 with the base-unit decision (§4).
   Today `isDefaultSelling` picks the default and nothing forbids selling any unit, so "we never
   sell pieces" is convention rather than rule. Cheap to add; only matters once real reps are
   using it.

8. **Receiving must be a 30-second action on a phone.** Not a nice-to-have — it is the *only*
   real fix for the silent case above, and the owner has confirmed it would change day-to-day
   behaviour more than any report. The target is: scan or pick the product, enter cartons and the
   invoice total, done, standing beside the van. If it is slower than writing on the delivery note,
   people will keep writing on the delivery note and the cost data stays approximate. Treat it as a
   **design constraint on the mobile slice**, not a screen to be specified later.

9. **Gaps raised on 2026-08-30.** All but deployment were closed in 6.1 on 2026-08-31; the
   decisions they produced are in the sections named.

   - **There is no deployment story at all** — still true. No `Dockerfile`, no compose file, no
     CI, and no backup for a database that will one day hold other businesses' money records.
     Everything so far has run on one laptop. It remains the only item that is a *business* risk
     rather than a missing feature. **Scheduled deliberately late** (owner, 2026-08-31): once the
     backend is finished, immediately before the web slice, so the thing being deployed is
     complete rather than a moving target. The plan is item 1 above.
   - ~~No customer credit limit~~ — resolved, and the answer was that **there is no credit
     limit**: see §6. The owner's correction, that credit is exceptional and must be cleared
     rather than capped, made the column unnecessary and the rule better.
   - ~~No stocktake~~ — **done**, §5.
   - ~~Product images~~ — **done**, §4.

10. ~~**Catalog writes take the whole product, not a resource per field.**~~ — **done**,
    2026-09-16. The decision and its reasoning moved to §4; what follows is the record of the gap
    as it was found. The one open question it carried — whether `POST /products/:id/barcodes`
    survives — was settled in favour of keeping it, for the reasons in §4.

    Raised by the owner on
    2026-09-07 while walking `docs/MANUAL-TESTS.md`, and the sharper half of it is a live
    overcharge, not a preference.

    The observation: `POST /products` accepts `basePrice` and `costPrice` but offers no way to set
    a **carton** price — and a carton price is not a factor of the piece price, even though the
    carton *quantity* is a factor of the piece quantity. Twelve pieces at ₦100 is not a ₦1,200
    carton; that is the whole reason a wholesaler exists.

    What happens today: `resolveUnitPrice` (`src/modules/catalog/pricing.ts`) falls back to
    `basePrice × unit.factor` when no `ProductPrice` row matches both the tier and the unit.
    `ProductService.create` writes no such rows, and `SaleService.resolveTierId` hands back the
    seeded default `Retail` tier for every walk-in — so **the fallback is the default path, not an
    edge case**. A product created with piece + carton sells a carton at 24 × the piece price,
    silently and with no error, until somebody remembers to POST a price row per tier per unit.
    The comment in `pricing.ts` already says the scaling is "a fallback, not the rule"; nothing
    made that true at the write end.

    Note the asymmetry that made it visible: `costPrice` is accepted at create and is **display
    only** per §2, never an input to a calculation. The field create takes is the one that changes
    no number; the one that changes every sale is the one it will not take.

    Decided (owner, 2026-09-07): **prices move into the `POST /products` payload and
    `POST /products/:id/prices` goes.**

    - Keyed by **unit name**, not unit id. The caller has no unit ids at create time — the units
      are being created in the same request.
    - `tierId` optional, defaulting to the organization's default tier.
    - `PATCH /products/:id` takes the same array and **upserts the listed rows without deleting
      the unlisted ones.** This is the trap to write down: replace-all semantics would let a
      partial PATCH silently wipe every price the caller did not resend, which is the same class
      of silent data loss as the zero-costing in §2.
    - The scaling fallback **stays**. It is right for a sachet against a piece, and refusing to
      price an unpriced unit would make the common case fail. It stays a fallback:
      `GET /products/:id/price` already returns `isTierPrice`, which is how a client marks a
      number as estimated.

    **Barcodes take the same inline shape** — optional on `POST /products`, keyed by unit name for
    the same reason. Whether `POST /products/:id/barcodes` *also* survives is **not settled**.
    Unlike a price, attaching a code to a product that already exists is a genuinely separate act:
    a supplier changes packaging, an unbarcoded item gets an internal EAN-13 generated, or someone
    is standing at the counter with a scan gun and a product already in the catalog. Multiple
    codes per unit are normal in FMCG — old and new packaging circulate together. `GET /scan/:code`
    and `DELETE /barcodes/:id` stay regardless.

    **Camera scanning is a client concern, and the server's half is already done.** The phone
    decodes on-device and calls `GET /scan/:code` with the resulting string; `GET /scan/:code/identify`
    classifies a code without a database hit. Nothing server-side changes. The constraint for the
    mobile slice is that the symbologies the scanner enables must match what `identify` supports —
    EAN13, UPC_A, EAN8, ITF14, CODE128, QR — otherwise the app decodes codes the API cannot name.

11. **The 15-minute access token is not broken, and the cookies are already built.** Raised
    2026-09-07 from "the refresh token has not been refreshing, so I keep logging out". Worth
    recording because the diagnosis was reasonable and the cause is somewhere else entirely.

    The cookie path is complete: `AuthController.respondWithTokens` sets `access_token` and
    `refresh_token` as httpOnly cookies on register, verify, login and refresh; `JwtStrategy`
    accepts a bearer header **or** the `access_token` cookie; `POST /auth/refresh` reads the
    refresh cookie and only falls back to the body; CORS runs `credentials: true`.

    **Swagger is not a client that refreshes.** Its Authorize box holds a pasted string, nothing
    renews it, and `swaggerOptions` sets `persistAuthorization` but **not `withCredentials`** — so
    the browser's cookies are never sent and the pasted bearer is the only credential in play. When
    it expires at 15 minutes, everything 401s until it is pasted again. That is the entire symptom.

    What to do, in order of value:

    - **`withCredentials: true` in `swaggerOptions`.** Then verify-otp's cookie authenticates
      Swagger directly, and renewing is one call to `POST /auth/refresh` — the browser swaps the
      cookie itself, with no copy-paste. Cheap, and it exercises the same path the web dashboard
      will use.
    - **Raise `JWT_ACCESS_EXPIRES_IN` on development machines only.** It is already env-driven
      (`src/config/env.ts`, default `15m`); a dev `.env` can say `12h` without a code change.
    - **Leave 15m in production.** Note though that the usual argument for a short window is
      weaker here than it looks: `JwtStrategy.validate` re-reads the membership on every request,
      so revoking someone takes effect immediately whatever the token's lifetime. What 15m still
      buys is bounding a *leaked* token for a still-active user.
    - **Refresh-on-401 belongs to the client, and nothing has implemented it yet.** The mobile app
      and the web dashboard each need an interceptor that retries once through `/auth/refresh`.
      This is the actual missing work, and it is in the app slices, not the backend.

12. **Left open after the 2026-09-16 idempotency fix.** The two holes themselves are closed
    (§13); these are the deliberate non-goals.

    - **`POST /payments/:id/void` and `POST /stocktakes/:id/cancel` are still not idempotent.**
      Making them so is now *safe* — the concrete-URL identity is what made it safe — but nobody
      has asked for those to be replayable, and adding it quietly would be scope the fix did not
      earn. The decision to take when a client needs it: a rep who voids a payment on a dying
      connection has no way to know whether it took, and `POST` twice is currently two voids.
    - **`STALE_CLAIM_MS` is 120 seconds, and that number is a guess.** It is how long a claimed
      but unfinished request is believed to still be running before another caller takes it over.
      Too low and a genuinely slow goods receipt is executed twice, which is the thing the whole
      interceptor exists to prevent. Revisit it with a real measurement of the slowest write,
      not by intuition — and err high, because the failure it guards against is silent while a
      key stuck in flight is loud.
    - **A client that gets the in-flight 409 has no guidance on when to come back.** The message
      says "retry in a moment". If a real client ends up hammering it, the answer is a
      `Retry-After` header rather than a shorter stale window.
    - **The 409 is the same status for two different problems**: "your key handling is wrong"
      and "wait, it is still running". Only the message distinguishes them. A machine-readable
      code belongs here the moment a client has to branch on it.

13. **Product variants, for the preorder product — and a warning.** Raised 2026-09-17 while
    assessing `PRD-PREORDER-AND-SHOP.md`; the strategic half is in `MARKET.md` §6.

    The preorder product is planned to run on **this backend**, as a module enabled per
    organization rather than a separate system talking to it over an API. That decision removes
    most of the PRD's integration contract: "connected mode" stops being a synchronisation
    protocol and becomes a flag on the organization, and "one inventory authority per location"
    enforces itself because there is only one ledger.

    It needs one thing the catalog does not have: **variants**.

    **A variant is not a unit, and conflating them would break §4.** A `ProductUnit` is a
    packaging multiple of the *same item* — twenty-four pieces make a carton, stock is recorded
    in the factor-1 base unit, and the entire ledger rests on that. A variant is a *different
    item* that shares a name: size 39 and size 41 are not multiples of one another, and neither
    is a base unit of the other. They coexist — "Nike Air Max, size 39, sold in pairs" has both.
    The PRD's own terminology table lists a variant as "size, colour, style, **or unit**"; that
    last word is the trap.

    **Decided 2026-09-19 — see [PRD-V2.md](PRD-V2.md) §2.** Neither of the two options first
    considered. The owner’s framing was better than the question: units and variants are
    *different axes that rarely both matter*. FMCG has units and no variants; shoes and phones
    have variants and one trivial unit.

    So a variant is an **optional sub-identity**: a `ProductVariant` table, and a **nullable**
    `variantId` on every table carrying stock or money for a product. Null means the product has
    no variants, which is every FMCG product, and nothing about their behaviour changes.

    Rejecting "a variant is its own `Product`" was the owner’s call and is right: it would make
    "Nike Air Max" a grouping rather than a thing, copy category and tax across every size, and
    turn "how many do I have" into a sum over rows that only convention relates.

    Because the columns are nullable and additive, this is now **safe to build in v2** rather
    than now — the decision was what had to be made early, not the migration. One warning
    carried forward into the PRD: adding `variantId` to the `StockBalance` unique key **will**
    hit the nullable-unique-column trap in §13, the same one `PurchaseTarget` hit. Two partial
    unique indexes, hand-written, from the start.

14. ~~**Nine dependency advisories that need a major upgrade.**~~ — **closed 2026-09-18, and
    without the major upgrade.** `npm audit` now reports **0 vulnerabilities** on Prisma 7 and
    NestJS 11.

    The 2026-09-17 reasoning below was sound but reached for the wrong instrument. Every remaining
    advisory was against a **transitive** package, and npm `overrides` pins a transitive dependency
    without touching the direct one — which `npm audit fix --force` cannot do, because it only
    knows how to bump the parent. Three lines in `package.json`:

    ```json
    "overrides": { "multer": "^2.4.0", "deepmerge-ts": "^8.0.2", "mysql2": "^3.24.4" }
    ```

    - **`multer` was the one that actually mattered**, and the reason this moved ahead of the
      deploy rather than after it. `@nestjs/platform-express` 11 pins 2.2.0, which carries four
      high advisories — DoS via crafted multipart field names, DoS via oversized array indices, a
      file-descriptor leak on aborted uploads, and a `fileFilter` race that bypasses the size
      limit. `POST /products/:id/image` is a live multipart route, so this was reachable rather
      than theoretical. 2.4.0 is the same major and fixes all four. The five `@nestjs/*`
      advisories were only ever this one showing through the dependency tree, and they cleared
      with it — no framework major needed.
    - **Prisma stays on 7.** `deepmerge-ts` and `mysql2` are pinned forward directly instead of
      letting npm drag `prisma` back to 6.19.3. `npx prisma -v` and the full suite were checked
      after: CLI 7.10.0, client 7.8.0, migrations untouched. **The warning stands — never run
      `npm audit fix --force` here** — but the advisories no longer justify waiting for a 7.x
      release that carries the fix.
    - `mysql2` still arrives through Prisma and is still never loaded: this project is PostgreSQL
      only. It is pinned anyway, because an unloaded vulnerable package is noise in every future
      audit and noise is how a real finding gets skimmed past.

    **The lesson worth keeping:** when an advisory is transitive, reach for `overrides` before
    concluding that the fix requires a major upgrade. The whole of this item was avoidable.

---

## 16. Money out: what I owe my vendors

Built 2026-09-19, as Slice 6.6 — numbered beside 6.5 because slice 7 in the roadmap table is the web dashboard. §6 cut the purchasing slice and left one door open:

> Vendor bills come back only if "what do I owe this supplier" becomes a question someone actually
> asks, and then they belong **beside receivables**, not in a slice of their own.

The owner asked it. This is that, built to that instruction — the money-out mirror of §11, not a
purchasing slice in a smaller hat. There is still no purchase order, nothing to raise before goods
arrive and nothing to close out afterwards. A bill records a debt that **already exists** because
the goods are already on the shelf.

### Receipt is goods, bill is money

`GoodsReceipt` stays exactly what §6 said it was: the record of a delivery. `SupplierBill` is what
the vendor is owed for it. They are separate rows for the same reason a sale and its payment are
separate, and for one more that settles the argument: **an opening balance has no receipt at all.**

That is not a modelling nicety. The business is owed-from on deliveries that happened before it
started using this system — the owner's own example runs 02/09, 04/09 and 17/09, entered on 19/09.
Recording those as goods receipts would add stock to the ledger that was received and very largely
sold weeks earlier, which breaks the one invariant `smoke.mjs` is built around: that the sum of
every movement equals the sum of the stock levels. **An opening balance moves money and nothing
else**, and there is a smoke check asserting exactly that.

### Every delivery raises a bill

Not only the ones somebody remembers to mark unpaid. A delivery that has not been paid for *is* a
debt, and the entire value of a payables total is that it is trustworthy without anyone having
remembered anything. A receipt that raised no bill would be money owed that never appears on
`GET /payables`, which is the failure mode this feature exists to prevent.

Paid in full at the door is not an exception: the bill opens and the payment closes it inside one
transaction, leaving a zero balance that drops off the payables list and stays in the history.

### `amountDue` is stored, not derived

The obvious design is to sum the goods lines. It is wrong, and the reason is worth keeping.

A vendor invoice routinely carries amounts that cannot be a stock line — a delivery charge, a
settlement discount — and `GoodsReceiptLine` deliberately cannot hold them, because §2 makes those
lines the exact cost of goods. Summing the lines would give a payables total that drifts from the
vendor's own statement, and **a payable nobody can reconcile against the vendor's paperwork is
worse than none**: it turns every phone call into an argument about whose number is right.

So `amountDue` defaults to the line sum and is stored in its own right. It explicitly does **not**
feed inventory cost. Stock is still valued from `GoodsReceiptLine.totalCost` per §2, and a delivery
charge is not part of what a carton cost. Two different questions, two different figures, and the
schema says so.

### One payment settles exactly one bill

The customer side carries `PaymentAllocation` because a single transfer routinely settles three
invoices there. Asked directly, the owner does not pay vendors that way: payment is on delivery, or
against one specific supply. So `SupplierPayment.billId` names the bill and there is no join table.

§11's rule survives in the form that matters — **which debt a payment answered is recorded, never
inferred.** What was dropped is machinery for a case that does not exist, which is the same call
§11 itself made in refusing 30/60/90 buckets before anyone asked to read them. A lump sum across
several deliveries is a migration on the day somebody actually makes one, and the schema comment
says so.

### Void, but no negative payments

§11 draws the line: correcting a **mistake** is a void, correcting **reality** is a negative
payment. Both exist on the customer side because both cases are real there.

Only the first is real here. A mis-keyed vendor payment happens and is voided — the row is kept,
stops counting, and the bill goes back to owing. Money genuinely coming back from a vendor is not
something this business does; when a vendor takes goods back they issue a credit note, which is a
change to what is owed and is recorded by correcting `amountDue`. `SupplierPayment.amount` is
therefore unsigned, with the schema comment explaining what would change if that stopped being
true.

### A supplier payment is not an expense

The trap, and the one most likely to be walked into by someone adding a feature later.

`computeProfit` subtracts `Expense` rows. The cost of stock already reaches profit through cost of
goods sold, so recording a vendor payment as an expense counts the same money **twice** and
understates every margin in the system — silently, on a 2–3% product, which is the whole signal.
Payables have their own tables and their own module for exactly this reason, and `PayablesModule`
shares nothing with `ExpensesModule`.

### Purchases, and the dashboard

`GET /reports/purchases` is the buying-side counterpart of `/reports/sales`, summed from
`GoodsReceiptLine` — append-only and accumulating since Slice 3, so the report is correct for
months that happened long before it was written. Value is the exact invoice total per line, never
`costPrice × quantity`, per §2. Quantities are reported **both** as received and as paid for,
because the gap between them is free goods: showing one alone either overstates what was bought or
hides what was given.

Both halves land on `GET /reports/dashboard` under `purchasing`, which required no new mechanism.
**The note in §12 saying targets were kept off the dashboard because "reps see the dashboard" was
stale** — that route has been `@Roles(...SEES_COST)` for some time, so reps cannot reach it at all.
The risk it described had already been closed by the role on the route; the doc had not caught up.
Worth recording as a small lesson: a rationale can outlive the condition that produced it, and a
stale one costs more than no comment, because it argues against a change that is actually safe.

### What is deliberately not here

- **No lump-sum payments** across several bills. See above.
- **No vendor credit notes** as their own row. Correcting `amountDue` covers it.
- **No 30/60/90 ageing buckets.** `daysOutstanding` is a sort, and §11 made this call already.
- **No `dueDate` enforcement.** It is nullable and nothing acts on it beyond reporting `overdue`
  for bills that were given one. The owner named a date and immediately said it might change; a
  required field would make everyone type a lie.
- **No rep-facing home screen.** Raised while scoping this — staff cannot reach the dashboard at
  all — but it is a screen that does not exist rather than one that needs trimming, and it belongs
  with the mobile slice.

---

## 17. The web dashboard

Planned 2026-09-19. Slice 7, and the last thing between here and v1 — decided in §15 that v1 does
not ship without it, because an API with no interface has no users.

### Who it is for

**Owners and managers, plus the counter.** Two audiences, one application:

- **Back office** — catalog, customers, money in and out, stock, reports, staff.
- **The till** — recording sales over the counter, on web *and* on mobile.

The till was nearly left out. The reasoning that put it back is worth keeping: the dashboard was
first scoped as back-office-only on the grounds that selling happens on the counter or on the
mobile app — but **mobile is slice 8, after v1**. So v1 would have shipped with no way to record a
sale anywhere except Swagger. Scope decided by audience rather than by workflow will do that.

Reps are still not a web audience. They get the mobile app in slice 8, and building rep views on
web would duplicate it.

### Stack

**Vite + React + TypeScript**, with React Router, TanStack Query and Tailwind. In `web/`, a sibling
of `src/`.

**Not a monorepo restructure.** Moving `src/` under `apps/api/` would touch `nest-cli.json`, both
tsconfigs, the jest config, `prisma.config.ts`, the migration paths and every path written into
this document — large churn against a backend that works, for no functional gain. `web/` beside it
costs nothing. If a second front end ever appears (v2 plans two product surfaces), one folder can
move then.

**Not Next.js**, and the reasoning changed once during the discussion, which is why it is recorded
rather than assumed. The first argument was hosting cost — a static site is free on Render and
never sleeps, while a Next service sleeps on the free tier. **That argument died when the decision
was made to deploy on a paid tier**, and the remaining one is narrower:

Auth here is httpOnly cookies on a *different origin* to the app. Next's headline feature is
server-side data fetching, which in that arrangement means forwarding cookies from the Next server
to the API by hand, and makes refresh-token rotation ambiguous about who sets the new cookie. The
usual outcome is fetching client-side anyway — an SPA with extra machinery.

The real cost of this choice is deferred, not avoided: **v2's preorder drops need public shareable
links, and WhatsApp link previews require OpenGraph tags in the initial HTML**, which an SPA cannot
produce. That surface gets its own small server-rendered app when it exists. It is gated behind a
customer asking for it and may never be built.

### Rules fixed before the first screen

Each of these is cheap now and miserable to retrofit across twenty screens.

- **Types are generated from the OpenAPI document**, never imported from Prisma. The API already
  carries full Swagger decorators; `openapi-typescript` against `/docs-json` produces the client
  types, regenerated by an npm script. The UI must not couple to the database schema.
- **Cookie auth, and no token in JavaScript-readable storage.** §15 item 11 records that this path
  is already complete on the server. Do not re-litigate it into `localStorage`.
- **Money is displayed, never computed** — with one bounded exception, below.
- **Cost fields may be *absent*, not null.** `redactCost` removes keys rather than nulling them
  (§9), so a shared `<Money>` renders an em dash for a missing value. A component that assumes the
  key exists prints `NaN` to a rep.
- **Every write carries a client-generated id and an `Idempotency-Key`.** On a till, a double-click
  is a double sale.
- **No offline queue on web.** That is the mobile app's job (§8). The ids above still make a retry
  safe.

### The till, specifically

**A barcode scanner is a keyboard.** USB scanners type the code and press Enter, so the till needs
one always-focused input with `GET /scan/:code` behind it. That is most of "fast" for free.

**Client-side totals are a preview; the server's figures are the truth.** The till has to show a
running total as lines are added, which looks like it breaks the money rule. It does not, and the
reason is §2: prices are stored **tax-inclusive**, so a line preview is `unitPrice × quantity` —
exact integer multiplication, with no tax arithmetic and no rounding. VAT, cost of goods sold and
the invoice total all come back from `POST /sales`, and **the receipt always renders server
figures**. A preview that disagrees with the receipt is a bug, not a rounding difference.

### Slices

| Slice | What | Done when |
|---|---|---|
| 7.0 | Foundation: `web/`, routing, generated types, cookie auth, role guards, `<Money>`, one table and one form pattern | **done 2026-09-19** |
| 7.1 | Home — the single `GET /reports/dashboard` call | **done 2026-09-22** |
| 7.2 | The till — scan or search, cart, units, price override, payment, receipt | **done 2026-09-25** |
| 7.3 | Sales history, returns, customers, statements, PDFs | **done 2026-09-25** |
| 7.4a | Money in — receivables, customer payments, allocation, void, bank accounts | **done 2026-09-26** |
| 7.4b | Money out — payables, supplier bills and payments, expenses | **done 2026-09-26** |
| 7.5a | Catalog — products, units, prices, barcodes, categories, packaging types, tiers | **done 2026-09-26** |
| 7.5b | Stock — levels, batches, movements, goods receipts, adjustments, transfers, locations, suppliers, stocktake | **done 2026-09-26** |
| 7.6a | Reports — profit, sales, purchases, collections, stock, movers, purchase targets | **done 2026-09-26** |
| 7.6b | Settings — organization letterhead, staff, working hours | v1 is closed |

Each is independently deployable. After 7.2 the application is genuinely usable, which is the
earliest point worth putting in front of a real shop.

### 7.0, and the two things it had to fix first

Built 2026-09-19.

**The root configs had to be scoped before `web/` could exist.** `tsconfig.json` carried no
`include`, so `tsc --noEmit` swept the whole working directory — the moment a `.tsx` file appeared
it would have tried to typecheck JSX under the API's `nodenext` module settings. The jest config
had no `roots`, so its `.spec.ts` pattern reached anywhere too. Both now name `src` and `test`
explicitly. This is the sort of thing that looks like an unrelated failure an hour later; it cost
nothing to fix first and would have cost an afternoon to diagnose second.

**TypeScript 6 versus `openapi-typescript`.** The Vite template installs TypeScript 6, which
`openapi-typescript@7` refuses as a peer. Pinned `web/` to TypeScript 5 rather than passing
`--legacy-peer-deps`, which matches the API and treats the incompatibility as real instead of
hiding it.

**One shared refresh, and why it is not a micro-optimisation.** Several requests failing with 401
at once is the ordinary case on a dashboard that loads six panels. If each started its own
`POST /auth/refresh`, they would rotate the same token family repeatedly, and the second rotation
presents a token the first already replaced — which the server correctly treats as a leaked token
and revokes the entire family (§9). The result would be that loading a busy screen signs the
person out. The client therefore keeps a single in-flight refresh that every 401 awaits.

**Verified against the running API rather than assumed.** Login sets both cookies with
`Access-Control-Allow-Credentials` for the Vite origin; `GET /auth/me` returns the session from the
cookie alone; `POST /auth/refresh` rotates from the cookie alone; the session survives it. The
cookie path had been complete on the server since §15 item 11, but nothing had ever exercised it
from another origin.

### 7.1, and the hole it found in the contract

Built 2026-09-22.

**The generated types described what we send, not what we read.** The OpenAPI
document carried paths, path and query parameters, headers and request bodies — DTOs have
`@ApiProperty`, so those came through in full — but **all 142 operations returned
`content?: never`**. NestJS cannot infer a controller's return shape, and no controller declared
one, so every client was left to hand-write what it read back. §17's promise that "a screen cannot
drift from the contract without the build saying so" held for half of it.

**The fix is a response type the service is annotated with, not one that describes it.**
`DashboardService.build(): Promise<DashboardView>` means a field changing shape is a compile error
in the API. A response class that merely mirrors what a service happens to return is *worse than
nothing*: it drifts silently and is trusted anyway. Declared per endpoint, as the slice that
consumes it is built — the alternative, typing all 142 at once, is weeks before anybody sees a
screen.

**Annotating it found a real weakness immediately.** `groupByCustomer` in `receivable.service.ts`
typed its `customer` as `unknown`. It never was: the `select` above it says exactly what the shape
is. Widening it meant every caller either re-narrowed it or, more often, quietly gave up on knowing
— and the dashboard could not describe its own response until it was fixed. It is now `DebtorGroup`,
and it carries `phone`, because chasing a debt is a phone call and the query already fetched it.

**`npm run api:types` never worked, and CLAUDE.md told people to run it.** npm executes scripts
through `cmd.exe` on Windows, so `${API_DOCS_URL:-http://localhost:4000/docs-json}` was passed
through as a *literal filename* and openapi-typescript failed looking for a file by that name. It
only appeared to work in 7.0 because the generation was run by hand as `npx openapi-typescript
<url>`. Now a small Node script that reads `process.env` identically on every platform, and says
what to check when the document cannot be read.

**Verified with real data rather than an empty organization.** Signed in as the org the smoke suite
builds and rendered the live payload: ₦1,532,000 owed to vendors across 7 bills, ₦1,507,800 bought
over 5 deliveries, ₦108,000 owed by customers, 30 days of trend. Worth noting because the first
attempt picked the *wrong* organization — several smoke runs leave orgs with identical names and
sale counts, and the one chosen predated payables, so the panel read zero and looked like a bug in
the screen. When a dashboard reads empty, check which tenant you are looking at before debugging
the query.

### 7.2, the till, and the cost leak it found

Built 2026-09-25. A sale can be rung up on the web: scan or search, cart with unit and price
editing, customer, payment, receipt, and both overrides.

**Seven endpoints got response types**, because a screen cannot consume what the contract does not
describe: `GET /scan/:code`, `GET /products`, `GET /products/:id/price`, `GET /price-tiers`,
`GET /customers`, `GET /bank-accounts`, and the sale trio — `POST /sales`, `GET /sales/:id` and
`GET /sales/:id/receipt`, where the first two share `SaleView` because `create` ends in
`return this.findOne(saleId)`. 132 operations still return `content?: never`; they get types as
the slice that reads them is built.

**Writing one down found a live cost leak.** `forReading` redacted `costOfGoodsSold` per line and
`costAmount` per return, and passed the invoice header's `costTotal` straight through — the sum of
exactly the numbers being removed. A `sales_rep` reading their own invoice got `total` ₦162,000
beside `costTotal` ₦28,200, which is the whole margin, on the endpoint §9 had already been through
once. Verified live against a running server as a rep before and after the fix.

Two things made it survive a dedicated security sweep, and both are worth remembering:

- **The unit test asserted the redaction it could see.** Its fixture never set `costTotal`, so
  `expect(sale).not.toHaveProperty('costTotal')` would have passed on a sale that never had one.
  A redaction test is only as good as the fields its fixture carries.
- **Nobody had written the shape down.** §9's sweep read the code; the leak needed the response
  *enumerated* — field by field, deciding for each one whether it belongs — before it was obvious.
  That is an argument for response types beyond typing the client.

**The idempotency key is bound to a hash of the body, and the till was designed wrongly first.**
The first version kept one key per sale and reused it across an override retry, reasoning that a
retry supplying a reason is "the same sale". It is not the same *request*: adding `forcedReason`
changes the body, `hashBody` changes, and the interceptor correctly answers `mismatch` with a 409.
So the override would have failed every time.

The stable thing is **the ids, not the key** (§8). The cart mints `saleId` and a `saleLineId` per
line once and keeps them, so two attempts describe one sale; each attempt carries a fresh
`Idempotency-Key`. `api.post` reuses a key across its own retry behind a refreshed session, which
is the case idempotency is actually protecting.

**The browser never works out a price.** Switching a piece to a carton, or naming a customer on
another tier, re-prices through `GET /products/:id/price` — because the fallback for a unit with no
tier row is `basePrice × factor` (§4), and that is arithmetic. Doing it client-side would be a
second pricing implementation and the first thing to disagree with a receipt. The till also passes
`tierId` on every lookup, resolved as the customer's tier or the default: **omitting it makes the
server return the fallback for everything**, which is the carton overcharge §4 exists to prevent.

**`unitPrice` is sent on every line, never left for the server to resolve.** The price was on the
screen and very likely said out loud, so that is what the customer pays. The consequence is that
changing tier has to re-price the cart rather than let the server surprise it.

**Verified by walking the till's exact request sequence** against the running API — same paths,
same payloads, same ids — rather than by asserting the components render. The load-bearing check is
that the cart preview equals the receipt total: ₦2,400.00 both sides, with ₦167.44 of VAT *inside*
it. Overselling by one unit refused with a 409 naming the shortfall, and an owner forced it through
with a reason. `npm run smoke` passed 369 checks afterwards, so the ledger still balances.

**Not verified in a browser.** There is no Playwright or headless Chromium in this environment, so
the rendering is unchecked — the wiring, the arithmetic and the refusals are not.

### 7.3, and teaching one endpoint to serve two readers

Built 2026-09-25. Sales history, sale detail, returns, customers, statements and both PDFs.

**`GET /sales` now browses as well as syncs**, via `order=desc` and an `until` bound. This was a
real gap rather than a UI preference: the endpoint ordered `createdAt ASC` because that is what a
syncing client needs — it walks forward from the oldest row it has not seen, and since its cursor
only moves forward, a skipped row is skipped forever. A person opening a sales list wants today at
the top and pages *backward*. Reversing on the client cannot do that; it reverses one page, not the
sequence.

`keysetWhereCreatedDesc` is the mirror walk, and `order` defaults to `asc` so every existing sync
client is untouched. The two differ in one more way worth knowing: walking forward, `since` is a
*starting position* and a cursor overrides it; walking backward, `since` and `until` are ordinary
filters applied *alongside* the cursor, because the starting position is the newest row. Nine tests
on the cursor helpers, including one asserting the backward walk is not a copy of the forward one —
getting the direction wrong pages away from the rows the reader wants while still returning
plausible results.

**Date bounds filter `createdAt`, not `occurredAt`**, so the screen is a ledger of what was
*recorded* rather than a period report. They are the same moment for anything rung up on the web;
they diverge for a sale synced from a device that was offline. Reports deliberately use
`occurredAt` in `period.ts` (§6), and the two answer different questions.

**PDFs are fetched as blobs through `client.ts`, not linked at.** A plain
`<a href="{API}/sales/:id/invoice.pdf">` is simpler and subtly broken: a raw navigation cannot run
the refresh interceptor, so once the 15-minute access token expires the shop gets a JSON 401 where
an invoice should be — intermittently, looking like a server fault. `api.document` refreshes once
through the same shared promise as everything else and hands back an object URL, revoked on a timer
because revoking it immediately races the new tab's own fetch. Still opened in a tab rather than
downloaded, because the server sends them `inline` for forwarding over WhatsApp (§6).

**Damaged goods are the rule the return dialog exists to force.** A return refunds a share of what
was actually charged either way, but `restocked: false` writes no movement at all, so crushed stock
never becomes sellable again. Defaulting it silently would either resell a crushed carton or lose
good stock, and neither is visible afterwards. Verified end to end: selling 10 took 10 off the
shelf, returning 4 restocked put exactly 4 back, returning 3 damaged moved the shelf not at all,
and both still credited the invoice.

**A note on the demo organization.** The 7.2 and 7.3 walkthroughs forced sales past the ledger to
exercise the shortfall override, which left several products deeply negative — correct behaviour,
unusable demo. It was put right with a **goods receipt**, not by editing rows: the ledger is
append-only and a receipt is what a real delivery does, so the history stays truthful. Worth
remembering when a demo org looks wrong: add the movement that fixes it rather than deleting the
one that broke it.

**One duplication left deliberately.** `DebtorGroup` now exists as a response class, and the
dashboard's `DebtorRow` describes the same rows. Both sit on declared return types over the same
value, so the compiler checks them against each other and they cannot drift silently. Collapsing
them is a tidy-up for whenever §17's reports slice touches that file.

### 7.4a, and the sync lag that made a screen look broken

Built 2026-09-26. Split from 7.4 so money-in ships on its own: receivables grouped per customer,
recording a payment with or without explicit allocation, voiding, refunding, and bank accounts.
Money-out — payables, supplier bills and payments, expenses — is 7.4b.

**The sync lag is a sync safeguard, and browsing now skips it.** `GET /payments` held back
everything newer than one second, so a payment recorded a moment earlier was missing from the list
that refetched right after recording it. On screen that reads as a lost payment, not as caution.

The lag exists so a *forward-walking cursor* cannot advance past a row that was still committing —
unrecoverable, because the cursor never goes back. Reading newest-first has the opposite exposure:
new rows arrive at the top, above wherever the reader has paged to, so a late commit is never
stepped over. Verified both ways: the row is absent from the `asc` feed and present in `desc`
immediately, and backward paging still returns no overlap.

**The same latent bug was in `GET /sales`, and the comment there argued for keeping it.** 7.3's
version applied the lag to both orders, reasoning that letting them disagree would be confusing to
explain. That was wrong in a way only visible on a screen, and it is now corrected in both places.
Worth recording as a pattern: *a safeguard written for one reader is not automatically right for
another*, and this is the second time that has bitten in the same endpoint pair.

**`keysetWhereUpdatedDesc` makes four cursor helpers, not two**, and the reason they do not collapse
is that they answer independent questions. Which *column* a feed walks follows from whether its
rows can change after they are written — `createdAt` for the append-only ledger, `updatedAt` for
payments, because a void must reach a client that already synced the row (§8). Which *direction*
follows from whether the reader is syncing or browsing. Eleven tests, including one asserting the
two stay independent.

**Allocation is offered as two honest choices, never a guess.** Either the server settles the
oldest invoices first, or the person says exactly which invoice gets what — there is no third mode
where the UI spreads money cleverly and nobody can tell what it decided (§5). Verified: an explicit
allocation settles exactly the named invoice; over-allocating one is a 409 naming what is
outstanding; and a payment larger than the whole debt leaves the remainder as credit rather than
pushing it somewhere. That last check initially "failed" because `allocateOldest` walks the *whole*
list — paying more than one invoice simply settles the next one too, which is correct and was a
wrong assumption in the test rather than a bug.

**Void and refund are kept apart in words, not just in code.** Both make an invoice owed again, so
they look interchangeable from outside — but a void says the money never moved, while a refund is
real money out that a bank statement will show. Choosing wrong makes the books disagree with the
bank with nothing on screen to explain why. The void dialog therefore states what a void *means*
before asking for a reason, and offers "record money going back instead" as a way out.

**Voided payments stay on the payments feed and never appear on a statement.** The feed is the
audit trail, where the mistake and its correction both have to be legible; a statement is the
customer's position, where a line claiming money moved when it never did is worse than no line.

### 7.4b, and the asymmetry between the two sides of the money

Built 2026-09-26. Payables grouped per vendor, supplier bills including opening balances, paying a
vendor, voiding that, and expenses.

**The vendor side is deliberately not the customer side with the words swapped**, and the whole
risk in this slice was building it as though it were. Three differences are structural (§16):

| Customer side | Vendor side |
|---|---|
| One payment allocates across many invoices | **One payment settles exactly one bill** — no allocation table |
| Negative payments record a refund | **Void only** — the column could hold a negative, the write path refuses it |
| Overpayment becomes credit on the customer | **Overpayment is a 409** — correct the bill's `amountDue` instead |

So `PaySupplierDialog` starts from a bill rather than a vendor, has no allocation control, and
offers no way to record money coming back. Each of those is an absence someone could "fix" later
without realising it was a decision, which is why they are written down here and in the response
class.

**An opening balance creates no stock, and that is now verified rather than asserted.** A bill with
no `goodsReceiptId` is what somebody owed on the day they started using the system; the goods
behind it arrived and probably sold long before. Inventing movements for them would put inventory
in the ledger that is not on the shelf — the exact thing smoke's sum-check exists to catch. The
walkthrough snapshots stock levels either side of creating one and asserts they are byte-identical.

**`GET /supplier-payments` got the same browse treatment as sales and payments** — third endpoint,
same fix. `GET /expenses` needed none: it has always branched on `syncing = Boolean(cursor ||
since)` and ordered by `occurredAt` with no lag otherwise. That was the right shape sitting in the
codebase the whole time, and the other three were written without looking at it.

**The expense form names the trap out loud.** A supplier payment is never an `Expense`: buying
stock already reaches profit through cost of goods sold, so recording it here too counts the same
money twice and understates every margin — quietly, showing up only as margins that look worse than
the shop knows they are. The dialog says so and points at "We owe", and `Expense.supplierId` is
documented as attribution rather than settlement.

### 7.5a, and a PATCH that answered 200 and did nothing

Built 2026-09-26. Products with units, prices and barcodes; categories, packaging types and price
tiers.

**`PATCH /products/:id` took a `units` array, validated it, wrote nothing, and answered 200.**
Found while planning the product form, and worth dwelling on because it is the worst of the three
possible behaviours: rejecting would have been honest, writing would have been correct, and
answering 200 while changing nothing is the one a caller cannot detect. A shop that started selling
by the carton could not record it without recreating the product.

`writeUnits` fixes it with the same shape `writePrices` already used — upsert by name, leave
anything unlisted alone — plus three limits that are the point rather than an omission:

- **Nothing is deleted.** `StockMovement`, `SaleLine` and `GoodsReceiptLine` all point at units.
- **`factor` may change**, and that is safe *only* because every dependent row copies it at write
  time: `SaleLine.unitFactor` is the snapshot, so redefining a carton cannot rewrite what a past
  sale took off the shelf (§4).
- **The base unit cannot move.** Stock is recorded in base units (§2), so promoting the carton
  would silently reinterpret every quantity in the ledger as cartons.

**The base-unit check moved from the request to the merged result.**
`assertExactlyOneBaseUnit` validates a *complete* set, which is right for `POST /products` and
wrong for a PATCH: a request adding a carton to a product that already has a piece lists no base at
all, and would have been refused for describing a change rather than a whole. `writeUnits` merges
what exists with what was sent and checks that.

**The product form's hardest job is not implying replace-all.** Units, prices and barcodes all
upsert and never delete what they are not sent. A list with remove buttons would imply otherwise,
and the removal would silently do nothing — so nothing offers to remove a unit or a price, and the
form explains why rather than leaving somebody to discover it. Prices genuinely *cannot* be deleted
through any endpoint, and that is defensible: a unit with no tier price falls back to
`basePrice × factor`, the silent carton overcharge §4 exists to prevent. Barcodes can be, because
`DELETE /barcodes/:id` exists.

**Adding a unit and pricing it in one request works**, which needed the write order fixed: units are
written first, then the name→id map is rebuilt inside the same transaction, because prices are
keyed by unit name and a brand-new unit is not in a map built beforehand.

**A note on cleaning up after verification.** The unit checks left two test units on a real product
and **units cannot be deleted through the API** — the very rule just added. They were removed
directly, which was safe only because nothing referenced them; the script checks sale lines and
receipt lines first and skips anything that does. A unit with history would have been a history
edit, not a cleanup.

### 7.5b, and the fourth endpoint to learn it serves two readers

Built 2026-09-26. Stock on hand with the lots behind it, deliveries, the movement ledger,
adjustments, transfers, counts, locations and vendors.

**The whole inventory module returned `content?: never`.** Every one of its endpoints was
undescribed in the OpenAPI document, so this slice is about half API work: `LocationView`,
`SupplierView`, `StockLevelRow`, `ExpiringBatchRow`, `StockMovementView` with its two richer
forms, `MovementPageView`, `GoodsReceiptSummary`/`GoodsReceiptView`, `TransferResultView`,
`RebuildBalancesView` and the stocktake trio. 69 of 142 operations now declare a response,
against 39 before it.

Writing them down did not find a leak this time, and that is worth recording too: §9's second
sweep had already been through these endpoints, and `redactCost` was applied correctly on every
one — per-lot `unitCost`, `valueAtRisk` on the expiry list, `totalCost` on a receipt line **and
on the lot behind it**, which is the field an attacker would have reached for. The walkthrough
asserts all four as a live rep rather than against a fixture, which is the lesson 7.2 paid for:
`not.toHaveProperty` passes happily on a mock that never had the key.

**`GET /stock/movements` browses now, and it is the fourth endpoint to need this.** Sales,
payments and supplier payments each learned it separately; the ledger was still sync-only, so a
movements screen would have read oldest-first and hidden anything from the last second. `order`
defaults to `asc`, so every syncing client is untouched. Four tests, including one asserting the
backward walk is `lt` rather than a copy of the forward one.

At this point the pattern is not a discovery but a checklist item: **any feed a person will read
needs both walks, and the sync lag belongs only to the forward one.** Expenses had the right
shape from the start and still does.

**`GET /goods-receipts` returned every delivery ever recorded, with every line on each.** Not a
bug in the month it was written and a page that grows without limit thereafter. It now takes
`since`, `until` and `limit` (100, capped at 500). The bounds filter `receivedAt` rather than
`createdAt` — the opposite choice to `GET /sales` — because a delivery is looked for by the day
it arrived, not the day somebody got round to entering it. No cursor: nothing syncs this feed,
and a screen that wants older deliveries asks for an older window.

**Adjust and move are dialogs on a stock row, not screens of their own.** You adjust *this
product at this location*, which is a row already on the page; a separate screen would begin by
asking for two things the click already said. Both inherit the till's override handling — a 409 is
a rule, supplying the reason *is* the override, and the row id stays stable across the retry while
each attempt carries a fresh `Idempotency-Key` (§8).

**Three rules the screens have to say out loud**, because each is a decision somebody could
otherwise mistake for a gap:

- **Counting is not adjusting.** The count sheet says posting is what writes corrections, and a
  counter who is not a manager is told plainly that somebody else posts it. The walkthrough
  asserts stock is byte-identical after counting and moved after posting.
- **Every delivery raises a bill.** The receive form says so beside the invoice total, and the
  receipt detail points at Money → We owe rather than implying the goods value is what is owed.
- **A surplus needs a lot.** Bringing stock on asks for a lot code, an expiry and what it is
  worth, rather than silently opening an unvalued batch — an opening balance entered with no cost
  is stock the valuation reads as free.

**Counted quantities have no unit picker, and that is deliberate.** Adjustments and transfers do —
somebody writing off two cartons should say "2" and "carton" — but a count sheet is filled in by
a person looking at a shelf, and offering cartons there invites a number that has to be multiplied
before it means anything. Counts are base units, like the ledger.

**Verified against the running server, not asserted.** 45 checks over the exact request sequence
the screens make: the transfer pair shares a group id, preserves batch identity and nets to zero;
over-transferring is refused with a 409 naming the shortfall and forced with a reason; a delivery
of 20 paid-for-19 prices at the received rate and raises a bill; counting moves nothing and
posting moves exactly the variance. `npm run smoke` passed 369 checks afterwards, so movements
still sum to levels.

**Still not verified in a browser** — there is no Playwright or headless Chromium here, so the
wiring, the arithmetic and the refusals are checked and the rendering is not.

### 7.6a, and a duplicate that had been hiding a wrong type

Built 2026-09-26. Profit, the sales slice, purchases, collections, stock, movers and purchase
targets. Split from 7.6 because the settings half is self-contained and this half is large:
**seventeen endpoints had no response type** — every report but the dashboard, and all six target
routes. 84 of 142 operations now declare one, against 69 before it.

**Collapsing `MoverRow` into `SalesGroupRow` found a latent bug.** §17 recorded the duplication as
"a tidy-up for whenever the reports slice touches that file", and doing it turned out to matter:
`MoverRow.cogs` was declared **required**, while the value behind it comes from a redacted path
where the key is removed. The compiler caught `HomePage` printing `${row.marginBps / 100}%`
against a possibly-absent field — which would have rendered `NaN%` the day that endpoint ever
served a redacted caller. It is closed to those roles today, so nothing was broken in practice;
what was broken was the *type*, which claimed a guarantee the producer does not make.

Worth stating generally: **a duplicated type is not merely redundant, it is a second chance to be
wrong**, and the copy is the one nobody re-checks.

**The period picker sends a name, never a date range.** Periods resolve in `Organization.timezone`
(§6), so a browser working out "this month" from its own clock would put a shop in Lagos an hour
out of step with its own reports — silently, and only near midnight. The client sends `period=month`
and renders the window the server resolved; a custom range is the one case it sends dates, and the
server still interprets them in the shop's zone. The window lives in the URL, so switching tabs
keeps it and a link to a particular report over a particular month is a link somebody can send.

**`/reports/sales` was the one to check, and it holds.** It is the only report open to a rep, and
it is the exact shape of the leak 7.2 shipped on `GET /sales`: rows redacted one at a time with a
header total — the same numbers summed — beside them. The walkthrough signs in as a real rep and
asserts `cogs`, `grossProfit` and `marginBps` are absent from **every row and from the totals**,
against a response that actually has rows in it. It also asserts the other nine cost-bearing
reports answer 403 rather than a redacted 200, which is the right answer for a report that is
*entirely* buying-price data.

**`TARGET_INCLUDE` was `product: true`**, which returned the whole product row including
`costPrice`. No leak — the controller is owner, manager and accountant only — but §9's rule is
**select, never exclude**, and an allow-list means the next column added to `Product` is invisible
here until somebody adds it deliberately. Narrowed to the four fields a screen renders.

**One figure was deliberately not shown.** The collections screen lays "collected" beside "sold",
because on a credit route they diverge and the gap is the cash position. The obvious third card —
one minus the other — is absent, and for two reasons worth keeping apart: money is displayed
rather than computed in the browser, *and* that subtraction would be wrong anyway, because
collections in a window include payments against invoices from months ago. The screen explains the
difference in words and points at `/receivables`, which answers the question properly.

**Verified against the running server**: 57 checks over the exact requests the screens make.
Periods echo back a resolved window in `Africa/Lagos`; half a custom range is refused rather than
guessed; the profit statement adds up line by line (`revenue = gross − VAT − returns`,
`grossProfit = revenue − cogs`, `operatingProfit = grossProfit − expenses`); every one of the
seven sales groupings answers; collections' method rows sum to their headline; and target progress
is `max(0, target − achieved)` on every live target.

**Still not verified in a browser** — no Playwright or headless Chromium here, so the wiring, the
arithmetic and the refusals are checked and the rendering is not.
