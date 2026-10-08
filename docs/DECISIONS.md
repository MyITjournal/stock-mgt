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
| 7 | **Web dashboard** — v1 does not ship without it; planned in §17 as 7.0–7.6 | **done** |
| — | **Deploy to Render** — paid tier, once the dashboard exists | **next** |
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

### VAT is one switch on the shop (2026-10-05)

`Organization.chargesVat` answers *does this shop charge VAT at all*. Most small shops here are
under the turnover threshold and charge none, and until this existed every sale quietly took 7.5%
out of its price as VAT — so a non-VAT shop's revenue, and every margin on top of it, read 7.5%
lower than the truth.

**Off, every new sale records 0% VAT on every line**, whatever rate its product carries. That is
the whole change: the rate was already frozen onto each `SaleLine` at the moment of sale (§6), and
everything downstream — profit, the sales report, returns, the dashboard, the invoice — already
works from those frozen figures. So reports needed no change, and **switching never rewrites a
sale already made**: an old VAT invoice reprinted after switching off still shows its VAT.

Four details:

- **Existing shops start on, new shops start off.** Existing shops had been recording VAT on
  every sale, so nothing moves for them until the owner flips it; the migration adds the column
  as `DEFAULT true` and then drops the default to `false`.
- **The product keeps its rate** (7.5% or Exempt) for the day VAT is switched on, so an exempt
  item stays exempt. The product form hides the box while VAT is off, because a question with no
  effect is noise.
- **A sale with no VAT prints no VAT line** — invoice PDF, till receipt, sale screen — rather than
  "of which VAT NGN 0.00", which reads as if there ought to be some. That follows the *sale*, not
  the switch today. The profit screen drops "Less VAT" the same way when the period has none.
- **Deliberately one switch, not a tax setup.** No registration dates, no rate tables, no
  per-customer exemptions. The owner asked for it so VAT could be turned off while they confirm
  their position with an accountant; anything more is a step toward accounting software (§1).

### One currency per shop, locked once money is recorded (2026-10-06)

A shop keeps its books in **one** of NGN (the default), USD, GBP, EUR, GHS or KES —
`SUPPORTED_CURRENCIES` in `src/common/money/currencies.ts`. Ghana and Kenya were chosen as the
nearest markets with the same distributor-and-carton trade; the owner accepted the list as is.

- **Chosen at sign-up, changeable in Settings only until money is recorded.** Every amount is a
  bare integer of the shop's currency, so once a price, sale, delivery (any stock movement),
  payment, bill or expense exists, changing it would relabel all of them — ₦50,000 would read
  £50,000. `OrganizationView.currencyLocked` says which side of that line a shop is on and
  `PATCH /organization` answers 409 past it. **A price counts**: a catalogue imported in naira and
  then switched to cedis is wrong on every line. Settings is for a wrong choice at sign-up.
- **The time zone moves with it, under the same lock.** Sign-up takes it from the browser's own
  clock (a Lagos importer pricing in dollars is still on Lagos time); a client that sends none
  gets the currency's home zone. It was never editable before; now it is, while unlocked, so a
  shop in Nairobi is not stuck an hour out of step with its own "today".
- **A customer paying in another currency is not a second currency** (owner, 2026-10-06). A
  diaspora buyer's transfer lands in the shop's currency; dollars taken in cash or into a
  domiciliary account are recorded at what the shop accepted for them, with the foreign amount in
  the payment's reference. Several currencies in one shop means exchange rates and gains and
  losses on them, which is accounting (§1).
- **Every currency here has two decimal places**, which the integer minor units assume. The West
  African CFA franc (XOF) has none, so adding it changes how amounts are typed and shown — it is
  not one more entry in the list.
- **On screen, the currency comes from the shop, never the call site**: `ShopCurrencyProvider`
  reads `GET /organization` once and `<Money>` defaults to it, with the short mark (`$`, `GH₵`).
  PDFs already printed `Organization.currency` as a code (`GHS 2,500.00`). Server messages that
  name an amount use `shopMoney` — two of them had `₦` written into the string.
- **The product VAT rate still starts at 7.5%**, Nigeria's. A shop elsewhere that charges VAT sets
  its own rate on each product; new shops start with VAT off, so most never meet it.

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

### A category in use cannot be deleted

Found 2026-10-02: the dashboard could add a category and never remove one. `DELETE /categories/:id`
had existed since Slice 2; the screen simply never got a button. Building the button raised the
question the route had been dodging: **what happens to the products still in it?**

**Refused with a 409 while any product or sub-category is still in it**, naming the count — *"12
products are in "Beverages". Move them to another category first."* The two alternatives are both
worse:

- **Delete and leave the products pointing at it.** The product page still says "Beverages",
  while its edit form shows no category and the products filter cannot find it. Three screens,
  three answers.
- **Delete and clear `categoryId`.** Past sales move to "uncategorised" in every report — history
  rewritten by a tidy-up.

Same rule as a bank account with payments against it. **Retired products count** (only deleted ones
are excluded), because a retired product's page still shows its category. And **re-adding a
deleted name revives that row**, as packaging types already did — the soft delete keeps the name
occupied under `@@unique([organizationId, name])`, and without the revive, re-creating "Beverages"
returned a 409 naming a category the caller could not see.

**Packaging types were deliberately left as they were**: deletable while in use, with products
keeping the reference (the docstring on `remove` says so). The same screen now deletes them too,
and says that products already packed that way keep it. The edit form then shows the packaging box
empty for such a product, which is the same disagreement the category rule avoids — acceptable for
a descriptive label that no report groups by, and worth revisiting if anybody is confused by it.
Price tiers still have no delete on screen: removing one changes what the customers on it pay, and
that is its own decision.

### Counting is not selling: `isSellable` on every unit

Raised 2026-10-03 by a distributor: the product form asked for a price per *piece*, and a
wholesaler never sells pieces. The cases that shaped it:

| Product | Counted in | Sold at the till |
|---|---|---|
| Peak 14g — 10 sachets a roll, 21 rolls a carton | sachet | roll, ⅙, ⅓, ½ carton, carton |
| Peak 360g — 12 a carton | piece | piece, ¼ carton, ½ carton, carton |
| 3 Crowns evaporated — 24 a tray | tin | 3s, half dozen, dozen, tray |
| Roll-on 50ml — 6 a pack, 30 a carton | piece | ½ pack, pack, ½ carton, carton |

**Peak 14g is the one that decides it.** The owner's instinct was that the base is the roll,
because no sachet — not even half a roll — is ever sold on its own. But half a carton is 10½
rolls, so selling one leaves half a roll on the shelf, and stock has to be able to say so. Stock
is counted in sachets; the till simply never offers one. **The base unit is the smallest piece that
can be left on a shelf, not the smallest thing sold**, and the form now calls it "Counted in"
because "base" means "what I sell" to a shop owner.

So `ProductUnit.isSellable` (default true), and three rules in `catalog/selling-units.ts`, pure:

- **How a box starts, when nobody ticked it:** a wholesaler's base unit starts unsold, every other
  unit sold, and a product's *only* unit is always sold — a delivery counted in `trip` has nothing
  else. The form shows this as a preview and **sends nothing for an untouched box**, so the
  server's rule is the one stored, not the form's copy of it.
- **At least one unit must be sold**, or the product cannot be sold at all — a 400.
- **Exactly one default, and it is sold.** `isDefaultSelling` used to be set per unit with nothing
  stopping two; it is now settled after every unit write: the unit asked for, else the current
  default while still sold, else the largest sold unit for a wholesaler and the smallest for
  anyone else. Asking for an unsold unit as the default is a 400, not a silent override.

**Only selling asks.** `resolveProductUnit(…, { forSale: true })` refuses an unsold unit and, for a
line with no `unitId`, takes the default selling unit instead of the base — which would otherwise
have sold a distributor a single sachet. Deliveries, counts, adjustments, transfers and **returns**
use every unit: a line sold before a unit was unticked can still come back. A barcode on an unsold
unit **still scans** (a delivery needs it) and carries `isSellable: false`; the till refuses it
with a message saying to scan the pack or carton.

Existing units were all migrated as sold, so nothing changed for any product already set up.

**A bug found on the way:** after a scan, the till was meant to load the product's other units in
the background so the cashier could switch from roll to carton. It never did — it looked the line
up by a key it minted itself, while `addToCart` mints its own. It now matches by product.

### A portion is a unit, and the form does the arithmetic

Added 2026-10-03. Half a carton, a sixth of a carton, half a pack are **ordinary units with their
own factor and their own price** — the product form's *Add a portion* row (½, ⅓, ¼, ⅙ of any
bigger unit) only works out the factor and the name. Nothing on the server knows a unit was made
that way.

**Not a fractional quantity.** Typing `0.5` against a carton was the other road, and it is worse
on both counts: in this trade half a carton is rarely exactly half the carton price, so it needs a
price of its own, and every quantity stays a whole number, which the ledger and smoke's sum-check
depend on. Peak 14g, verified end to end: one carton in (210 sachets), then ½ carton, ⅙ carton and
two rolls out, leaves exactly 50.

Three details, all in `web/src/lib/portions.ts`:

- **Refused when it does not come out whole**, and the message says the number: *"½ of a carton
  is 10 and 1/2 rolls"*. While the product is new the fix is to count in something smaller; once
  saved the counted-in unit cannot change, so the message says the portion cannot be made.
- **Named `1/2 carton`, never `½ carton`.** Unit names print on PDF invoices and thermal receipts,
  and the PDF's built-in fonts have no ⅓ or ⅙ — the same reason money prints as NGN. The picker
  shows ½; the stored name uses a slash.
- **Only bigger units are offered** as the whole — half of one sachet is never whole.

Separately, the walkthrough asked for a portion's price **without** a `tierId` and got the
`basePrice × factor` fallback: ₦2,100 for a half carton that sells for ₦20,500. The till always
sends the tier, so it never saw this — but it is the case for making the base price optional next.

### The phone is the scanner

Added 2026-10-04. The owner was plain about it: **a member of staff with only a phone must be able
to sell**, with no computer and no add-on app. A USB or Bluetooth scanner already worked — it is a
keyboard — but a phone has a camera, not a scanner. Two places use it, through one component,
`web/src/components/CameraScanner.tsx`:

- **The till, continuously.** *Scan with camera* opens the back camera in a panel pinned to the top
  and **leaves it open until Done** — a fifty-item order is fifty scans with no reopening. Each read
  beeps, vibrates and adds the item through the ordinary `GET /scan/:code`; a **Just scanned** strip
  under the picture shows that line's unit and quantity controls, so *Peak 14g, 1/6 carton* is set
  without scrolling a long cart. The text box steps aside while the camera is open, because its
  focus-stealing would pop the phone's keyboard over the picture on every tap. An unknown code is
  a message, never a stop.
- **Add product, once per box.** Barcodes are captured **as part of adding the product** — no
  separate registration step — because the person typing the name is holding the pack. One box per
  unit, since a carton usually carries its own code (often an ITF-14 on the box) distinct from the
  item inside. The codes ride in the same `POST /products`; a misread fails the GS1 check digit and
  the whole product is refused rather than half-saved. A saved product's *Add a code* has the same
  camera button.

Three choices:

- **ZXing, not the browser's `BarcodeDetector`** — which iPhones do not have, and a shop cannot be
  told to buy Android. It is ~120 kB compressed and **loaded only when a camera is first opened**,
  so the till is no slower for anyone who never uses it. Only the shapes printed on goods are tried
  (EAN-13/8, UPC-A/E, ITF, Code 128): fewer to try is a faster read, and a QR code on a poster is
  not a product.
- **The same code is ignored for two seconds.** A camera reads a barcode many times a second;
  without the pause one carton held up would add five. Scanning it again after the pause adds one
  more, which is how five identical cartons are rung up.
- **Cameras need a secure page** — https, or `localhost` in development. Test with the phone on the
  live site.

**A real gap found on the way: a price read with no tier now uses the default tier.** The
walkthrough scanned without a `tierId` and a priced carton came back with **no price** — "no
tier" meant the `basePrice × factor` fallback, which since the base price became optional can be
nothing. The till always sends a tier once its lists have loaded, but a cashier scanning in the
first moment would have seen "no price". `resolveTierId` in `price-tier.service.ts` now decides it
for every price read — the scan, `GET /products/:id/price` and the till search — so they cannot
disagree. Sales already did this for walk-ins.

### The till suggests as you type, in one request

Added 2026-10-04, from real use: picking an item at the till took **about ten seconds** on the
hosted instance, and nothing appeared until Enter. Measured, not guessed: on Render's free tier
**every request costs one to two seconds** — the home page alone, with no database at all, took
1–1.7s — and the till made **three in a row** per pick: the text tried as a barcode, then a product
search, then a price lookup. The database was never the slow part, so **indexes would not have
helped**; the number of round trips was.

**`GET /products/till-search?q=&tierId=`** answers with up to ten active products, each with its
**sellable units already priced on the cart's tier** (`TillSearchResult`). The till asks it **while
the person types** — after two characters and a 250ms pause — so by the time a suggestion is
tapped the price is already known and the item goes into the cart with **no request at all**.
Locally the same pick went from 76ms over three requests to 18ms in one.

Details:

- **Enter still means "barcode first".** A scanner types faster than suggestions arrive and
  presses Enter, so Enter with nothing highlighted tries the text as a code, then the search —
  which is usually already cached from the typing. Arrow keys highlight a suggestion; Enter then
  picks it. Escape clears.
- **With no `tierId`, the default tier** — never the bare `basePrice × factor` fallback, which is
  what a price lookup without a tier returns (§4).
- **Lean on purpose**: no cost, no barcodes, no lots. Only units sold at the till, and a product
  with none is not suggested. Retired products are not suggested.
- **Declared before `GET /products/:id`** in the controller: Nest matches routes in order, and
  `:id` would otherwise take `till-search` and refuse it as a bad UUID.

Still true after this: **Render's free tier costs a second or two per request and sleeps after
fifteen minutes** (a 74-second first request was measured). The paid Starter plan is the fix for
that, and it is a cost decision rather than a code one.

### No base price means no fallback, never a guess

Added 2026-10-03. `Product.basePrice` is **nullable**. With one, a unit that has no price of its
own is charged `basePrice × factor`, as before. **Without one there is no fallback**:
`resolveUnitPrice` answers `price: null`, the till refuses to add that unit and says to ask a
manager to price it, and a sale that names no `unitPrice` for it is a 400.

Why: the portions walkthrough asked for a half-carton price without a tier and got the fallback —
**₦2,100 for a half carton of Peak that sells for ₦20,500**, because the base price was a sachet
price. A distributor never sells the counted-in unit, so a price for it means nothing, and any
number typed there to satisfy a required box becomes a silent wrong price on every unpriced
portion. This is the §4 carton overcharge in its purest form.

Details:

- **A price the seller names is still accepted** for an unpriced unit — that is what was agreed,
  not a guess. Only the server's own derivation refuses.
- **Zero is a price, null is not.** A free sample is a decision; an empty box is the absence of one.
- **On an edit, `null` clears it**; omitting it leaves it alone. The form always sends the box on
  an edit for that reason.
- **Existing products keep their base price** — the migration only drops `NOT NULL`.
- **`scan.service` used its own copy of the pricing rule**; it now calls `resolveUnitPrice`. A
  rule change reaching two callers and missing the third is exactly how the fallback would have
  survived in scans alone.

**Found on the way, fixed separately (2026-10-04) — a real gap for a mixed shop.** The till's own
docstring and §17 said naming a customer re-prices the cart. **It did not.** `tierId` followed the
customer, but lines already in the cart kept the price they were added at; only lines added
afterwards used the customer's tier. So a cashier who scanned first and picked the wholesale
customer second charged retail. A correct rule written next to code that does the opposite — the
§19 lesson again.

**The fix: picking a customer on another tier re-prices the whole cart** (`repriceCart` in
`TillPage`, rules in `applyRepricing` in `till/cart.ts`). Triggered from the customer change itself,
not an effect, one `GET /products/:id/price` per line. Four rules:

- **A price somebody typed stands.** A line whose price differs from its list price was agreed at
  the counter; it keeps it, and only its list price moves, so it still shows as overridden.
- **A line the new list cannot price keeps its old price and is named** — *"Lotion (carton) has no
  price on the Wholesale list, so it keeps its previous price. Check before taking payment."* —
  never silently left at retail.
- **Payment waits.** "Take payment" is disabled while prices are moving, so a sale cannot be
  recorded half re-priced.
- **Only the latest choice lands.** A run counter discards answers for a customer the cashier has
  already changed away from, and starting a new sale cancels one in flight. A line whose unit
  changed while its price was in flight is left alone.

### Size is plain text, and on hand is on the list

Asked 2026-10-02: there was nowhere to say a product is 400g except inside its name. `Product.size`
is a **nullable free-text column** — `400g`, `33cl`, `1L` — set on the product form and shown,
read-only, beside the name on the products list, the till (search results and cart) and the
receipt. Not on PDF invoices, by the owner's choice.

**Text, not a number and a unit**, because nothing computes with it: no price per gram, no
conversion. Structure would cost a picker on every product for no answer anybody asks. If sizes
ever become options of one product (Milo 400g / 800g / 1kg), that is v2's variants (`PRD-V2.md`),
and a text column does not stand in its way.

Three details: a blank size is stored as **null, never `''`**; on an edit, **omitted leaves it,
`''` clears it** (the letterhead rule); and **search matches size** as well as name and SKU. The
receipt carries it as **its own field**, not folded into `description`, because the receipt is a
contract with a printer and a printer that predates the field must keep working. Like the name, it
is read live from the product rather than snapshotted on the sale line.

The products list also gained **On hand**, from one `GET /stock/levels` summed per product — the
same sum the product page already showed. A service shows a dash rather than a zero, because zero
reads as "sold out".

**On hand is said in the shop's units** (2026-10-04). A distributor counts Peak 14g in sachets, so
the raw figure is 2,965 and unreadable; the list now says **"14 carton, 2 roll, 5 sachet"** —
`describeCount` in `web/src/lib/quantity.ts`, biggest unit first, with the exact count on hover.
Display only; nothing is computed from the words. Two choices: **portions are skipped**
(`1/2 carton` would give "14 carton, 1 1/2 carton", which nobody says) — detected by the `n/m `
prefix the portion helper names them with — and **the counted-in unit is always the last step**, so
the parts add back to the count exactly. Verified live: after a half carton is sold the list reads
"13 carton, 13 roll" — the loose sachets and the opened roll's remainder make a whole roll.

A delivery the shop **charges the customer for** stays what §4 below says: a product with
`trackStock` off. A delivery the shop **pays for** is an expense and never a product.

### A catalog comes in from a spreadsheet, previewed and saved whole (2026-10-05)

`POST /products/import` (owner/manager) and *Products → Import from spreadsheet*. Typing three
hundred products into the form is the biggest setup cost a new shop has, and the main gap the
market comparison found. The rules are pure, in `catalog/product-import.ts`.

- **One row per product**: name, size, category, what it is *counted in* (blank means piece) with
  its price, then **as many bigger units as the row has** — Unit 2, Unit 3, Unit 4 … each with
  **how many counted-in units it holds** and its price — and one barcode for the counted-in unit.
- **Portions and selling, fixed against a real sheet the same day.** The first version took two
  bigger units and decided selling by the form's defaults, and the owner's first file failed on
  every row: a lotion carton of 12 sold only as 3s and 6s was written as two units both called
  "carton", and the roll-ons' carton sat in Unit 4, which was not read at all. Now: a unit named
  **`1/2 carton`** (slash, as the form names portions) is a portion of the row's carton, its
  "how many" may be empty and is worked out — refused, with the arithmetic, when not whole (½ of
  15 is 7½), when there is no carton in the row, or when a typed count disagrees; and **a priced
  unit is sold at the till, an unpriced one counted only** — the spreadsheet's way of ticking
  *Sold at the till* without a column for it. That also retires the old warning about a carton
  charged at `factor × piece price`: an unpriced carton is simply not sold. A row with no prices
  falls back to the form's defaults, with a warning.
  The counted-in price is the base price, as on the form; bigger units' prices go on the
  **default** price list. No price-list column: shops here price the item, not the buyer.
- **Every cell travels as text** and the server reads it. `parseNaira` takes `14,500`, `N14,500`,
  `₦14,500` and the exponent form a spreadsheet stores, as a decimal string — never through a
  float. More than two decimals rounds half-up to the kobo, because that is what the cell showed.
  For `.xlsx` the dashboard passes `parseNumber: raw => raw`, so it gets the stored text too.
- **Preview and save are one function.** `dryRun` returns every row as `add`, `skip` or `error`
  with reasons in words; the save re-plans against the catalog as it is then and writes only if
  **no** row is in error. All or nothing, in one transaction.
- **A product is its name and size together**, case and spaces aside (`productKey`), as the till and
  the receipt show it. The first version used the name alone, and an owner's file failed on *Dry
  Impact* the 50ml roll-on and *Dry Impact* the 200ml spray. Same name and size twice in one file
  is refused, naming the first row.
- **A product already in the catalog is skipped, never changed.** Bulk price changes belong with
  export (download, edit, upload back), not here. A side effect worth having: a retry after a save
  that landed, even with a fresh key, finds every name taken and skips every row.
- **Units sell exactly as the form decides** — `defaultIsSellable` and `chooseDefaultSellingUnit`
  are called on the planned units, so a wholesaler's sachet is counted and not sold. And it
  **warns, without refusing**, about a sold unit with no price (the till will refuse it) or a
  carton with no price of its own (it will be charged `factor × the piece price` — the §4
  overcharge, said before it happens).
- **Categories by name, case aside**; a new one is created once however many rows name it, and a
  deleted one is revived, as the category screen does. SKUs are generated and suffixed `-2`, `-3`
  against the shop *and* the file. Barcodes are validated like any other, and one that reads
  `6.154E+12` is named for what it is — the spreadsheet rounded it and the digits are gone.
- **Written in a handful of statements.** Ids are minted in the plan, so each table is one
  `createMany`: 2,000 products import in about five seconds locally. One by one through
  `ProductService.create` would be minutes on the free tier, inside a transaction.
- **Not in it, deliberately: cost and opening stock.** Cost comes from deliveries (§2). Opening
  stock needs what was paid, so it is its own step, next.

⚠ **The trap hit building it.** The route needs a bigger JSON body than the 100kb default, so a
path-scoped `json({ limit: '3mb' })` is registered in `main.ts` before Nest's parser. Registered
bare, **every other request in the API arrived with an empty body**: Nest decides whether to add
its own JSON parser by looking for any middleware *named* `jsonParser`, path or no path, finds
this one and skips the global one. Smoke caught it at the first register. The parser is wrapped in
a function with another name, and the comment says why.

### A service is a product with the stock flag off, not a category

Asked on 2026-09-27: a delivery to Ikeja is charged for and appears on an invoice, but it is not
a thing on a shelf. The instinct was to reach for categories — "Goods" and "Services" — and the
worry was category proliferation.

Neither is needed. **`Product.trackStock = false` is the whole mechanism**, and it was already
there. A non-stocked product is priced, taxed and invoiced exactly like any other; `sale.service`
simply returns the line without calling `recordOutbound`, with `costOfGoodsSold: 0`. It is
excluded wherever it would otherwise be noise: reorder alerts filter on `trackStock`, a stocktake
refuses to count it, and `resolveProductUnit` rejects it from stock operations outright.

**`Category` is orthogonal to this.** A category groups things for reporting — sales by category,
purchases by category, a purchase target scoped to one. Whether a line touches the ledger is a
property of the product, not of how it is grouped. So a single *Services* category is worth
having if service revenue deserves its own line on a report, and "Goods" as its opposite is
worth nothing at all: it would name the absence of a flag that is already on every product.

**The consequence to know: a service shows a 100% gross margin**, because cost of goods is zero
and nothing was bought. The driver's fuel and time are an expense, so they reach profit through
the expenses line rather than through cost of goods sold. Gross margin is flattered and operating
profit stays honest, which is the right trade while this is a management tool rather than
accounting (§1). It is worth revisiting only if services ever become a large share of turnover —
at which point the question is whether they need a cost of their own, not whether they need a
category.

Two things still have to be set deliberately on a service: a **base unit** (`trip`, `delivery` —
factor 1, never moves) and the **VAT rate**, which is per product and defaults to 7.5%. A charge
that should not carry VAT needs `taxRateBps: 0` on the product rather than a workaround later.


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

### Every screen worth keeping downloads as Excel (2026-10-05)

A Download button on Products, Stock on hand, each report and the four money lists (Invoices →
All, Bills → All, Money in, Money out). The owner's one condition was that it must not slow
anything down.

- **Nothing loads until it is pressed.** `write-excel-file` (one dependency, `fflate`, already
  present for the import's reader) is a dynamic import in `lib/exportSheet.ts`; it builds into its
  own ~15 KB gzipped chunk and the main bundle is unchanged. A report's download uses the response
  the screen already holds; the money lists walk their endpoint at its largest page (500, or 200
  for supplier payments), so a year of payments is a handful of requests, made only on the click.
- **The same figures as the screen.** Money is the server's kobo divided by 100 for display —
  the conversion `<Money>` does — written as a number with a `#,##0.00` format so Excel can sum
  it. A margin is basis points shown as a percentage. Statuses come from `payState`. Nothing is
  added up in the browser, so a file and a screen cannot disagree.
- **Absent is empty.** A cost `redactCost` removed is an empty cell, never `0`, for the same reason
  the screens never zero it: a zero reads as free goods to whoever sums the column.
- **Text where Excel would mangle.** Barcodes and SKUs are written as strings, so `6154000000005`
  is not shown as `6.154E+12` and a UPC keeps its leading zero — verified by writing and reading a
  workbook back.
- **Products use the import template's columns**, with extra *Unit 4…* columns when a product has
  more units, plus *Other barcodes*, *SKU* and (for those who see cost) the last delivery's cost.
  Prices are the default list's, the base price for the counted-in unit, and blank where a unit
  has none of its own. This is what makes "download, change prices, upload back" possible later —
  the import still skips names it knows, so that needs its own preview of what would change.
- **Stock on hand downloads counts, not value.** Its rows carry a per-unit cost, and multiplying it
  out would be a second, rounder valuation; the Stock report's download is the server's, from lot
  totals rounded once (§2).

### A delivery is corrected, never edited (2026-10-06)

Found in real use: 7 cartons recorded when 6½ arrived, 6 of them paid for. Nothing could put it
right — receipts were create-only — and the wrong count also put the wrong cost on the lot (the
value of 84 spread over 91 pieces, or the reverse).

- **The person states the truth, not a difference**: each line's received and paid for (any unit,
  decimals where they come to whole pieces) and the invoice value. `planCorrection` (pure) works
  out what moves; a correction that changes nothing is refused.
- **Stock moves on the line's own lot**, as a `receipt_correction` adjustment — out when fewer
  arrived, in when more did — dated the delivery's `receivedAt`, so a month's purchases and vendor
  targets read the corrected figures while `createdAt` says when it was fixed. Fewer than have
  already been sold from that lot is the usual 409, overridable by an owner or manager with a reason.
- **The lot and the line take the true figures.** Lots are not the ledger — movements are — and a lot
  is *what arrived and what it cost*; correcting a fact about it is what makes stock value and the
  cost of later sales right. Sales already made keep their snapshot cost (§6). `Product.costPrice`
  is refreshed only if the line is still the product's latest delivery.
- **The bill moves by the change in value**, in the same transaction, refused if it would drop below
  what has been paid or credited against it — void the excess payment first.
- **History is kept**: `GoodsReceiptCorrection` (reason, who, when, bill before and after) and a
  line each with received / paid for / value before and after. The delivery page lists them; values
  are redacted like every other cost for a role that may not see cost. Any number of corrections.
- **The preview is the real thing rolled back.** `/corrections/preview` runs the whole transaction
  and throws a `RolledBack` carrying the result, so it meets every refusal the save would — the
  stock 409 included — and the dashboard shows the bill before and after without computing money.
- **Which unit the line shows in** is the biggest of the product's own units both figures are whole
  in, portions skipped (`displayUnit`) — chosen from the product, so a line corrected to pieces and
  back returns to cartons. Smoke caught the first version keeping a line in pieces forever.
- ~~**A corrected line keeps at least one piece.**~~ Superseded 2026-10-07, below: every reader
  that divides by a lot's `quantityReceived` already guarded zero (valuation, margins, unit costs,
  `costPrice`), and the one that did not — a count's surplus borrowing the *newest lot anywhere* —
  now skips lots that received nothing.

**The wrong product, and a line that never came** (2026-10-07). Found in real use: Deep Impact
**roll-on** entered when the lotion came, with no way to say so — the form fixed figures, never
the product, and refused a line of zero. The owner asked for it **without it getting more
cumbersome**, so it is one *Wrong product?* link per line that swaps the name for a type-to-find
product box; the line's figures stay as typed, in the right product's units.

- **Swapping** sends `productId` with the line's true figures. The recorded product's whole
  `quantityReceived` comes back out of the line's own lot (`receipt_correction`, the usual 409 and
  override if some has sold); the old lot is zeroed and kept with its movements, since the ledger
  is only added to; the right product goes in as **a new lot** at the line's figures, same supplier,
  lot code and expiry, dated the delivery's day; and the line points at it, so the purchases
  report and vendor targets count what really came. The bill moves only if the value did. Both
  products' `costPrice` displays are refreshed from their latest delivery.
- **A line may go to zero** when it never arrived, and then its value is zero too: a vendor who
  still charged for it is a change to the bill's amount, not to the goods. The right product with
  nothing of it arriving is refused as meaningless.
- `GoodsReceiptCorrectionLine.productIdBefore/After` keep a swap; null when the product was right.
- The preview names what comes out and what goes in (`removedProductName`, `removed`,
  `addedProductName` on its line), from the same rolled-back transaction as before.

⚠ **The trap hit verifying it**: a smoke check read `/stock/movements` the sync way (`asc`), which
holds back the last second, and the correction movements were that recent — the ledger looked 168
short. Browsing reads use `order=desc` (§8); a check right after a write must too.

### Opening stock is an opening balance, never a delivery (2026-10-05)

`GET`/`POST /stock/opening` (owner/manager) and *Stock on hand → Opening stock*. The gap it
closes was found in real use: a product with no stock had **no row on Stock on hand**, so the
adjust dialog that can already record an opening balance could not be reached, and the only way
to get day-one stock in was *Receive delivery*. That raised a bill — an owner saw an invoice
settled in June sitting on *We owe* — and counted the goods toward this month's vendor targets
and purchases report.

- **It writes opening-balance adjustments.** One lot per line (`lotCode: 'Opening'`), valued at
  **cost per unit × quantity**, exact, with `quantityPaidFor: 0`. Valuation and cost of goods
  sold read it like any other lot; no bill, vendor target or purchases report sees it, because
  all three read receipts or paid-for quantities. It also gives a product its first real rate for
  `lastKnownRates`, so goods sold ahead of their paperwork stop being estimated from nothing.
- **The cost is required.** Per unit on screen, because that is what an owner knows ("a carton
  was ₦14,000"); multiplied into a total before storing, so §2 still holds. Zero is accepted when
  typed — genuinely free goods — but a blank is refused, because a ₦0 lot shows a 100% margin on
  everything sold from it.
- **Offered only where stock has never come in at that location.** "Ever had a positive
  movement here" is the test. That makes entering it twice impossible rather than unlikely — the
  save re-checks inside its transaction and answers 409 — and still offers a product that was
  sold before it was counted, since that one has only outbound movements. A product that already
  has stock is corrected with a count. Per location, so a second branch sets up its own shelves.
- **Mixed units are separate lines**: 14 cartons and 3 loose rolls are two lots, each at its own
  cost. The sheet starts each product on its biggest unit. **Amended 2026-10-07: a line's quantity
  may be a decimal in its unit** (6.25 cartons) when it comes to whole counted-in units, so most
  products are one line; the total is `unitCost × quantity` rounded once, and the lot stays whole.
  Changing a line's unit clears its cost, and the cost box names its unit permanently.

**An opening lot's cost can be corrected** (2026-10-07). Found in real use: three pieces entered
as a 1/2 pack at a whole pack's cost were worth ₦8,054 a piece, and the lotion's average carton cost
on *Margins* read ₦50,114 against the owner's ₦48,376 — an average above both lots it averaged,
which is how the cause was found. `POST /stock/opening/lots/:batchId/cost` (owner/manager) takes
the cost of one of a chosen unit and sets the lot's total to `unitCost × quantityReceived ÷
factor`, rounded once; `/preview` returns the same without writing, so the dialog shows the new
total from the server. **Only the value changes**: quantity and movements stay (a wrong count is
a stocktake's job), sales already made keep the cost they recorded (§2's snapshots), and a
`LotCostCorrection` keeps before, after, who and why — the reason is required. A lot is opening
stock when it carries an `opening_balance` movement and has **no receipt line**; a delivered lot is
a **409**, because deliveries are corrected through their receipt, which also moves the bill
(§5). `Product.costPrice` is rewritten only when no delivery has set it since. A stock adjustment
could not have done this cleanly: a write-off takes FEFO from whichever lot goes next, which was
the 78-piece delivery, and would have shown as a loss.
- **Written in three statements.** `StockService.recordNewLots` creates lots, movements and
  balances with one `createMany` each — possible because every lot is new, so no balance row can
  exist yet. It lives in `StockService` so every ledger write still goes through one place, and
  the rows are what `recordInbound` would have written. `Product.costPrice` is set as a delivery
  sets it, as a display convenience only.
- **On screen, not a spreadsheet**, by the owner's choice: it works on a phone, and tabbing down a
  list is about as quick as Excel. A spreadsheet version would reuse the import pattern.

### Opening stock when adding a product (2026-10-08)

A product added after day one used to need two visits: Add product, then Stock on hand → Opening
stock to say how many were already there. Add product now ends with an optional **"Already on your
shelves?"** — how many, in which unit (the biggest by default, since that is how a shelf is
counted, and "6.25" cartons is accepted when it comes to whole pieces), the cost of **one** of
that unit, an expiry, and the place when there are several.

**No server change, on purpose.** It sends the product, then the same `POST /stock/opening` the
Opening stock screen sends, so everything above holds without restating it: an opening balance at
cost, no bill, nothing toward a vendor target, refused for a product that already has stock at
that place. A single combined request was considered and declined — it would make the catalog
call into inventory inside one transaction, an edge the module graph does not have, to save one
round trip on a screen used a few times a week.

**The price of two requests is a half-done save, and the form owns it.** If the product goes in
and the stock does not, the form says so in those words, the button becomes **Save opening stock**
and retries only the stock — the product's id is minted once and the saved product kept — and
Cancel becomes Close, because the product exists. A form that simply re-sent everything would add
the product a second time. Changing the unit clears the cost, as on the Opening stock screen: a
carton's cost kept against a piece values the lot twelve times over.

Shown only when adding (an edit has Opening stock and Correct cost for that), for a product that
tracks stock, to a role that sees cost — which is everyone who can add a product today.

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

### The same customer twice: suggest, warn, merge (2026-10-07)

Found in real use: two customers entered twice, one already with two invoices, so one shop's debt
read as two. **Prevention** is in the form: as a name or phone is typed, existing customers that
match are offered (up to five), and picking one at the till sells to them with nothing added. A
phone already on file is called out and the button reads *Add anyway* — **a warning, never a
refusal**, because two different people may share a name, and a refusal at a busy counter is how
a sale goes unrecorded.

**Cure** is `POST /customers/:id/merge` (owner/manager): every sale and payment of the duplicate
moves to the customer kept, in one transaction. Those are the only two tables with a
`customerId`; receivables, statements, credit and the owes-already gate are all derived from them,
so nothing else moves. Contact details the kept customer lacks are copied over, and the duplicate
is soft-deleted with `mergedIntoId` so what happened stays readable. **The trap kept for later**:
sales sync on `createdAt` (§8), so a device that had already synced a moved invoice would not learn
its new customer. No device syncs today; the mobile app must re-read merged customers' sales.

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

### A sale that looks already recorded: warned, never blocked (2026-10-08)

The owner recorded a customer's sale because a member of staff had not got to it, and asked how
the staff member would know before entering it again. Nothing would have told him. The
`Idempotency-Key` stops one device sending one sale twice; it cannot know that two people are
recording the same thing that happened.

**What counts as the same sale** (`sales/duplicates.ts`, pure):

- **A named customer: the same day**, in the shop's timezone — the day the sale is *dated*, so a
  sale entered from yesterday's notebook is checked against yesterday.
- **A walk-in: ten minutes either side.** A walk-in is nobody in particular, and a day of
  walk-ins each buying one Peak Milk is a normal day.
- **The same items in the same amounts**, in any order, two lines of one product added together.
  **Prices are not compared** — the second person may have typed a different price for the same
  goods, and it is still the same sale. A request that left the unit to the server is matched on
  product and quantity alone, rather than guessing the unit.

**A warning, not a rule.** A customer can genuinely buy the same thing twice in a day, so the
409 (`error: POSSIBLE_DUPLICATE`, with up to three `duplicates`: number, total, when, who
recorded it) can be passed by **anyone** with `allowDuplicate: true` — no reason, no owner. It is
checked **before anything is written**, so *Record anyway* starts clean; it carries the same sale
`id` and a fresh key, the till's usual retry shape. The till keeps `allowDuplicate` on for
every later attempt at that sale, because a stock or credit override retry would otherwise meet
the warning a second time.

**The till** (`DuplicateDialog`): *Already recorded?*, the sale(s) it looks like with who
recorded them and when, *Open it* in a new tab (the cart stays behind it), **Same sale — clear the
cart**, and **Record anyway**. Sales → History gained a **Recorded by** column and the time of
day, so the day's sales can be read down before one is entered.

⚠ **The trap it exposed in smoke.** Smoke records the same sale step after step on purpose, and
the first run failed on step 35 — not on the credit refusal it was testing, but on the duplicate
warning arriving first. Worse, the check just before it ("a second credit sale is refused")
**passed** — on the wrong 409. A test that expects "a 409" without saying *which* proves nothing
once a second rule can answer with one. Smoke's `api()` now sends `allowDuplicate: true` on
every `POST /sales` unless the step sets it, and step 59 sets it to `false` to test the warning.
**A future client — the mobile app's offline queue in particular — must expect this 409** and ask
the person, never resend with `allowDuplicate` on its own.

Not built: comparing against a sale still sitting unsent on another device. The check can only
see what reached the server.

### Credit is due in five days, and every member of staff sees who is due (2026-10-06)

The till gained **Pay later** (§17): a switch, not "0 against Cash", which sends
`payment: { amount: 0 }` so no payment row is written and the invoice is owed. The
gate above stays — the owner was explicit that it must not be relaxed.

The same branch gave a credit sale a **due date: five days after the sale**, at the
start of that day in the shop's timezone (`Sale.dueDate`, set by `dueDateFor` in
`sales/due.ts` when the sale is recorded with less paid than its total). Four
details worth keeping:

- **It is stored, not derived**, so changing `CREDIT_DAYS` later moves future sales
  and leaves the past alone — the same snapshot rule as every money figure on a
  sale. The migration backfilled sales that still owed, five days from when they
  happened. A sale paid in full has none.
- **The due date does not move when the sale is paid.** What decides whether a sale
  is on the reminder is its balance, through the one rule (`saleBalance` over
  `LIVE_ALLOCATIONS`), so a voided payment puts it straight back on and a returned
  invoice drops off.
- **`GET /sales/due` is open to every role.** The owner asked for it on purpose: the
  person at the counter sees the customer walk in and is the one who can ask. It
  carries names, phone numbers, invoice numbers and what is owed — nothing that
  reveals a buying price, so `SEES_COST` has nothing to guard. It lists what is
  overdue, due today, or due in the next two days, oldest first, and counts the
  days in the shop's timezone (`daysPastDue`) so the browser never works out a day.
- **It shows on the Till as well as Home**, because Home is closed to a sales rep and
  a cashier would otherwise never see it. On the till it starts folded to one line;
  when nothing is due it is not shown at all.

The due date is a **reminder, not a rule.** Nothing refuses a sale because an invoice
is overdue — the gate above already refuses new credit to anyone who owes at all,
so a second, date-based rule would refuse nobody new.

**Every report of a debt says the same date** (same day, a follow-up branch). The
unpaid list (`GET /receivables`, and so the customer page and the statement) carries
`dueDate` and `daysPastDue`; the receipt payload carries `dueDate`, so the invoice PDF
tells the customer **Payment due by** on the document they pay from; the invoice
download has a Due column. All of them read the stored date and the one count in
`due.ts`, so the reminder, the list and the paper cannot disagree. A due date is
shown **only while money is owed** — an invoice in credit is not overdue for
anything — and an invoice without one (settled before due dates existed, reopened by
a void) shows its age, as the list did before. Adding `dueDate` to the receipt is
safe for printers: it is a contract that may grow, never one that may change.

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

**The invoice is A5, the statement stays A4** (2026-10-06, owner: A4 "would only be wasting
paper"). An invoice is a header, a few lines and the accounts to pay into; on A4 two-thirds of the
sheet was blank. `INVOICE_PAGE` in `invoice.ts` sets the size, margins and a step-smaller type; a
long invoice still flows onto a second page. The statement is a list that grows and is sent over
WhatsApp more often than printed, so it was left alone. ⚠ **A5 only saves paper when the printer
has A5 paper in it.** On an A4-only printer the browser prints the A5 page on an A4 sheet, either
at actual size (half the sheet blank, nothing saved) or scaled up. The real saver at a busy counter
is a till-roll receipt, which is still the mobile slice's job (above).

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

### What staff may touch (2026-10-07)

The owner, after adding their first staff member: "the stock and settings give the staff too much
control." The rule now is that **staff sell, take deliveries and count; anything that changes what
goods are worth or what the shop is belongs to an owner or manager.** Staff here means `sales_rep`
and `storekeeper`; the accountant is unchanged.

| Act | Staff | Why |
|---|---|---|
| Ring up a sale, take a payment | yes | the counter's job |
| Record a delivery | yes | goods arrive whoever is on shift |
| Count stock | yes | counting changes nothing until posted |
| See products, prices and stock | yes | they sell from them |
| **Adjust (write off) or move stock** | **no — was yes** | a decision, and the easiest way to hide a loss |
| **Take goods back** | **no — was yes** | a return pays money out and restocks; a made-up one takes either |
| Add, edit or retire a product; prices; categories; price lists | no | already owner/manager on the server |
| Places, vendors, opening stock, correcting a delivery or a lot's cost | no | already owner/manager |
| Business details, opening hours, staff | no | their own password only |

**The server changes were the two bold rows**: `POST /stock/adjustments` and
`POST /stock/transfers` moved from `STOCK_RECORDERS` to `INVENTORY_EDITORS` (goods receipts
stayed), and `POST /sales/:id/returns` from `SELLERS` to `TAKES_BACK` (owner, manager).
Everything else was already refused with a 403 — **the gap was the screens**, which offered Edit,
Retire, Add product, the set-up tabs, a price list on the customer form and three settings pages to
people the server would then turn away. Those are hidden now, and a typed link into a hidden tab
lands on a page that works (`StockLayout` → Products, `SettingsLayout` → *Your password*), per
§19's rule that hiding a nav item does not decide where somebody lands. Smoke step 55 checks the
server half.

**Returns were closed on the owner's word**, asked separately: "this age calls for extreme
carefulness because people are desperate." A return is the one counter act that pays money *out*
of the till without a sale to show for it, so a cashier recording one that never happened pockets
the refund — or, restocked, gets goods back on the shelf to take later. The cost is that a crushed
carton waits for an owner or manager; that was judged the right price. A negative payment was
already closed the same way (§9, 2026-09-25).

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

### Staff are signed in on one device at a time (2026-10-07)

The owner signed in with a staff member's password while he was signed in, and asked whether that
was a door for hackers. It is not a way in without the password, but before this nothing limited
how many places one account was signed in, so a leaked password could be used quietly beside its
owner for as long as anyone liked.

**Now signing in ends every other session of that person, for every role except owner and
manager** (`signsInOnOneDevice`). A shared or stolen staff password therefore shows itself: the
real person is thrown out and says so. Owners and managers keep several devices, because a phone
at the till and a laptop in the office is how they work; the option of one device for everybody
was offered and not chosen.

- **Both paths that start a session ask it**: `AuthService.issueForUser` and
  `switchOrganization`. Rotation renews the same session, so it does not — a fourth path that
  mints a session needs the same line, as with working hours.
- **Out at once** (since 2026-10-08 — it was "within 15 minutes"; see the next section). A
  cashier cut off mid-sale keeps the cart, because the till keeps a draft (§13).
- **A revoked, never-replaced refresh token is no longer called theft.** It used to fall into the
  reuse branch and log *Refresh token reuse detected* — which every ended session would now do.
  It answers *This session has ended* instead. A *replaced* token presented again is still reuse,
  and still revokes its whole family.

Smoke step 56 signs Bola in twice and checks the first session can no longer renew, and that
its access token is refused on the very next request.

### Who is signed in, and signing somebody out (2026-10-08)

The owner asked whether they could see how many devices were signed in, and suspend from there.
Suspending already existed (Settings → Staff); seeing who is on did not.

**Nothing new is collected.** Every sign-in starts a chain of refresh tokens, renewed every fifteen
minutes while the app is in use, and each row already carried the user agent and an IP.
`GET /staff/sessions` (owner, manager) reads those chains: one live token per chain (rotation
revokes the old as it issues the next), the chain's first token for *signed in at*, its newest
for *last active*. **No IP address is returned** — it means nothing to an owner and is personal
data. `describeDevice` (pure, `staff/sessions.ts`) turns the user agent into "Chrome on
Android"; Edge, Opera and Samsung's browser all claim to be Chrome, and every iPhone browser
claims Safari, so the order of its checks is the whole function.

**Active now means renewed in the last 30 minutes**, not "holds a live token". A refresh token
lives for days, so a phone whose browser was closed yesterday still holds one; counting it would
tell an owner somebody is at work who went home. Thirty minutes is one renewal plus slack. A
person with no live chain still has a row with **last seen**, from the newest token on record
(housekeeping removes chains a while after they expire, so it can be null).

Home shows the count as one line (*3 people signed in now, on 4 devices · See who*) from
`dashboard.signedIn`, the same `SessionsService` the Staff screen reads — the two cannot disagree.
`SessionsService` sits in its own `SessionsModule` with no dependency but the database, so the
reports module can use it without adding an edge to the graph that once had to lift
`WorkingHoursModule` out to avoid a cycle.

**Sign out** (`POST /staff/:userId/sign-out`, owner only, like every other staff write) is not
suspension: they can sign straight back in, inside their hours. It is for a phone left signed in,
or a password the owner suspects is shared. **Only this shop's sessions end** — a person may work
for two businesses, and the other is not this owner's to sign out of. **Not for yourself**
(400): it would end the session you are using; changing your password signs you out everywhere.

**Ending a session is now immediate, everywhere it happens.** Revoking refresh tokens stops the
*next renewal*, but the access token in the other device is a signed JWT good for up to fifteen
more minutes. An owner who presses *Sign out* believes the person is out — the same reasoning that
made a password reset revoke sessions (§9, 2026-09-25). So `TokenService.endSessions` revokes the
tokens **and** sets `Membership.sessionsEndedAt`, and `JwtStrategy`, which already reads the
membership on every request to catch a suspension, refuses any access token issued before it.
The one-device rule uses the same call, so a staff member signing in somewhere new ends the old
device on its next tap as well.

⚠ **The trap hit building it: `iat` is whole seconds.** The first version compared the cut
against `iat`, rounding the cut down so the new session survived. Smoke signs in twice inside
one second, so the *first* device survived too — and a real one could, on a fast double sign-in.
Every access token now carries **`iatMs`**, its issue time to the millisecond, and the cut is
taken **before** the new session is issued, so the new token is always after it. A token from
before `iatMs` existed falls back to `iat`, which can only make it look older — the safe
direction for a token being refused. **Any new path that ends sessions should call
`endSessions`**, not `revokeAllForUser`, or it ends them fifteen minutes late.

Smoke step 57 checks the owner sees the cashier, Home agrees, a cashier can neither see nor sign
anyone out, the owner cannot sign themselves out, a signed-out cashier's very next request is
refused, and she can sign straight back in.

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

**Money in records the store too (2026-10-08).** The form sent none, so every payment taken there
landed in that row. It now sends the default store without asking when the shop has one, and
shows a *Store* picker, starting at the default, when it has several. The row was renamed
**"Recorded on Money in"**, which is what it now holds: older payments, and anything recorded
without a store.

### Cash banking: whose hands the cash is in (2026-10-08)

Owner: who is holding the shop's cash, since when, and did it reach the bank. **Money → Cash**
shows one row per person — **received in cash** (cash payments they recorded, voids left out),
**paid out in cash** (cash refunds, cash expenses and cash supplier payments they recorded),
**banked**, **waiting to confirm**, and **still holding** = received − paid out − banked − waiting
— with **oldest unbanked**, first in first out: what left their hands is taken to be the oldest
money. The arithmetic is `src/modules/cash/cash.ts`.

**A `CashBanking` row is neither a payment nor an expense.** The money was counted when the
customer paid; a banking only says it left somebody's hands and where it went — one of the shop's
accounts, or **handed to the owner**. It touches no invoice, bill, collection or profit figure.
"Handed to the owner" **ends the trail**: following the owner's own pocket is accounting.

- **Staff record only their own** (*Sales → My cash*, since Money is closed to them); owner and
  manager record for anyone. The accountant sees everybody on Money → Cash, records their own,
  confirms nothing.
- **Waiting until confirmed**, by the owner or a manager. **Nobody confirms their own.** A row is
  confirmed as it is written when the person writing it could have confirmed it — the owner
  always, a manager for somebody else — because a second click by the same person checks nothing.
- **Waiting is out of their hands but not banked**, so it is its own column: an owner sees both
  what people still hold and what is claimed and unchecked.
- **Shortfalls stay as still holding.** No write-off. Banking more than is held is a 409
  `MORE_THAN_HELD` with no override. **"Not received"** (owner/manager, reason required) voids a
  banking and the amount goes back to still holding; the row is kept.
- **Counting starts the day it shipped.** `Organization.cashCountedFrom` was set by the migration to
  midnight, shop time, on 2026-10-08 for every shop then existing — counting from the first sale
  would have shown everybody "still holding" months of cash banked with nothing recorded. Null
  (every newer shop) means from the beginning. Bankings themselves are never bounded by it.
- **Home: "Cash not yet banked"** is the screen's total, amber once some is more than a day old,
  with "₦X waiting for you to confirm" under it. A person holding a negative (paid out more cash
  than they took) never cancels a colleague's holding — the receivables rule.
- `GET /bank-accounts` opened to the **storekeeper**, who sells and so holds cash.

Rows with no `recordedByUserId` belong to nobody and are left out. Two bankings recorded at the
same instant could together exceed what is held — no lock, on purpose, at a shop's volumes.

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

### Who was paid is typed, and salaries have their own screen (2026-10-06)

The owner found "Paid to" offering only vendors, defaulting to **"Nobody in particular"**. Vendors
are paid through bills (§16), so the list offered the wrong people and the default said nothing.
**`Expense.paidTo` is now a required typed name** — the landlord, the mechanic, a member of staff —
with names already used offered as suggestions. `supplierId` stays on the row and the API for
older data; the migration copied each named supplier into `paidTo`. Rows from before keep a null.

**Salaries are still an expense, shown apart.** The owner asked for them "standalone". Taking them
out of profit would overstate it — a month that paid ₦300,000 in wages did not make that ₦300,000
— so they stay in `expenses` and the subtraction, and what is standalone is where they are seen:

- **`ExpenseCategory.isSalaries`** marks the one category the *Money → Salaries* screen records
  into. Seeded with every shop, backfilled onto each shop's existing "salaries" (or created), and
  **never deletable** (409) — renaming is fine. No partial unique index enforces "one per shop":
  Prisma cannot express one and would propose dropping it in every later diff, so the seed, the
  backfill and the refused delete are what keep it single.
- `GET /expenses?kind=salaries|other` splits the two lists; omitted, both, as sync and profit want.
  The Expenses picker leaves the salaries category out, so pay is never filed as diesel.
- **Profit reports `salaries` and `otherExpenses` beside `expenses`** (their sum), each computed on
  the server, and the profit screen shows *Less salaries* and *Less other expenses*.
- **No payslips, deductions, pension or dividends.** Those are where payroll and accounting start.
  A dividend is not a cost of running the shop — recording one as an expense would understate
  profit, the same trap as a vendor payment.
- Expenses were already closed to cashiers and reps (`SPENDERS`), so nobody at the counter sees a
  colleague's pay. A manager does.

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

**Each now carries its share of the month's sales** (2026-10-07, owner): `paidShareBps` and
`uncollectedShareBps` on `collections`, worked out on the server like every other percentage.
Two choices worth knowing:

- **The base is sales *with* VAT (`sales.monthGross`), not revenue.** Uncollected is defined as
  `grossSales − collected`, so paid and uncollected add up to the VAT-inclusive figure. Measured
  against revenue they would add up to 107.5%, and the screen would look broken to anyone who
  added them. Home says "of ₦X sold" with that figure printed, so nothing is hidden.
- **Uncollected is `10000 − paid`, not rounded on its own**, so the two never come to 99.9% or
  100.1%. **Paid may pass 100%**, since collections include older invoices; the screen then says
  so. **No sales gives null, not 0%**: "0% collected" reads as a month nobody paid.

Beside them, `profit.operatingMarginBps` (operating profit over revenue), and the month's sales
tile is now **Revenue this month**. **Cost of goods sold has its own tile** (owner: "Revenue alone
is okay. COGS can have its own"), with `cogsShareBps` — exactly `10000 − marginBps`, so the two
make 100% of revenue — set beside Revenue this month.

**Uncollected this month was then taken off Home** (owner: "the same as unpaid invoices"). They
are not quite the same — uncollected is this month's sales less this month's payments, unpaid is
everything still owed from any month — but on a young shop they read alike, and two tiles that
look identical make a person doubt both. `uncollectedThisMonth` and `uncollectedShareBps` are
still sent; nothing reads them on screen. **Expenses got a tile** in its place in the profit row
(`expensesShareBps`, salaries included), so it reads gross profit − expenses = operating profit.

**Goods available for sale** (same day, owner: "the value of inventory already handled for a
month") ends that row: opening stock + delivered this month, at cost, as `dashboard.stock`. It
comes from the same `StockSummaryService` walk as Reports → Stock, which gained
`availableValue` — opening + delivered **summed exactly and rounded once**, not the two rounded
columns added. Offered the closing value instead and declined: that is the inventory valuation,
already on Reports → Stock, whose heading was renamed from "What the stock is worth" to
**Inventory valuation** in the same change.
**A wider renaming to standard accounting terms is planned once the remaining bugs are done**, so
this is the first of those labels, not a one-off.

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

### Targets are cartons of a category (2026-10-04)

**This reshapes the section below**; where they disagree, this one stands. The owner, running a
distributorship, put it plainly: *"companies deal only in cartons"*, *"product is not so
important, category is much more important"* — *"I have to buy 112 cartons of lotion in a month,
it doesn't matter whether it is Perfect & Radiant or Deep or Soft Cup, as long as it is registered
as a lotion."* And a money quota is a total across everything a vendor sells, so breaking it down
per category was the wrong shape entirely.

So **a target is a vendor, a category, a month and a whole number of cartons** (`targetCartons`).
Gone: `productId`, `targetValue`, `displayUnitId`, `unitFactor`, the one-of CHECK, the product
unique index, and with them the rollup's category-minus-product subtraction — there is nothing
left to subtract.

**A carton is each product's biggest unit** — carton, tray, box, whatever it is called — so a
carton of 12 and a carton of 24 each count as one, which is how the vendor counts. Achieved is
`Σ quantityPaidFor ÷ that product's carton`, summed exactly and rounded once to one decimal: a
half-slot reads 9.5. A product whose biggest unit is its base has **no carton**, so its deliveries
cannot be counted; it is named on the target (`productsWithoutCarton`) rather than counted as
pieces, which would read as a hundred cartons of sample sachets. Received-not-ordered and
paid-for-not-free stand as before.

**Why not keep base units, as stock does?** Because a category's products have different cartons;
there is no single factor to convert a category's pieces with. That is also why the migration
**cleared every existing target** — at the owner's word, during testing — rather than converting.

**Editable**: the cartons and the note. The vendor, category and month are what the target *is*;
the update DTO does not carry them, so `forbidNonWhitelisted` refuses them by name.

**On the dashboard**, as `purchasing.targets` — every target this month, not a glance — drawn as
one **ring meter** each: the filled arc in brand green on a lighter step of the same green, the
percentage in the middle, *"86.5 of 112 cartons"* beneath and *"Target met"* / *"Over target"* in
words, so nothing depends on colour. A ring rather than a two-slice pie because it is a single
ratio against a limit. The section is absent when there are no targets.

**Hidden for retail.** The Targets tab shows for wholesale and mixed shops only — navigation, not
security; the routes still answer, and turning it on for retail is one line in `ReportsLayout`.

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

### A vendor's month in money, beside the cartons (2026-10-06)

The per-category money quota was removed with the move to cartons (above), and that stands. What
the owner then described is different: a vendor often expects **a figure for the whole month** —
"₦12M from us this month" — on top of its carton targets. So `VendorMoneyTarget` is **one amount
per vendor per month**, unique, editable (amount, VAT choice, note), removable outright.

- **Progress is the invoice value of what arrived**, summed from `GoodsReceiptLine.totalCost` for
  that vendor's receipts in the month window — exact invoice figures, never `costPrice × qty`, and
  free goods add nothing because they carry no value. Received, not ordered, like the cartons.
- **VAT is a choice on the target, because vendors differ.** The owner confirmed not every vendor
  adds it. With `addsVat` (the default) the vendor quotes before VAT and puts 7.5% on top of each
  invoice, so ₦12.9M of invoices meets ₦12M: `moneyProgress` takes VAT off the **month's total,
  once**, with `splitTaxInclusive` — the split a sale uses — rather than line by line, so rounding
  happens a single time. Without it, invoices count whole.
- **Where it shows**: `moneyTargets` on `GET /purchase-targets/report` (and therefore no longer
  dependent on there being carton targets), `purchasing.moneyTargets` on the dashboard, one ring
  each — the ring component now has a money variant beside the carton one. The Rebates panel names
  it ("money target met", or the percentage) as context for the owner's call, never as a gate.

### Stock in and out: opening + delivered − sold ± adjusted = total (2026-10-07)

The owner read *Decisions somebody made* (the stock audit) and asked why deliveries were missing.
They were missing on purpose — that list is hand-made changes, so a write-off is not buried under
a hundred ordinary sales — but there was nowhere that told a product's whole story for a period.
`GET /reports/stock-summary` and *Reports → Stock → Stock in and out*: one row per product with
stock or movement, base units, shown in the shop's own units.

- **Every movement lands in exactly one column**, so a line adds up by construction; the end is
  never computed separately and hoped to agree. `columnFor` (pure): `opening_balance` → opening,
  `receipt` and `receipt_correction` → delivered, `sale` and `return_in` → sold (as goods gone,
  positive), everything else → adjusted, signed (write-offs, counts, transfers, `return_out`).
- **Opening stock entered during the period counts as opening**, not adjusted — a shop that started
  on the 7th sees its day-one stock as where the month began.
- **By `occurredAt`**, like every report: a backdated sale counts on its day. Two `groupBy` reads of
  the ledger (before the period; during it, by type and reason), so it cannot disagree with the
  ledger — smoke checks the whole shop's closing total equals stock on hand.
- **Quantities** are open to every role, like the reorder list. The audit list gained a line
  saying deliveries and sales are not in it.
- **And money, for `SEES_COST`** (same day). The owner could see purchases but not what opening
  stock was worth, and wanted to check opening value + purchases − cost of sales ± adjustments =
  stock value now, while records are few. The two ledger reads group by `batchId` as well when the
  caller may see cost; each group is valued at its lot's exact ratio (`totalCost ÷
  quantityReceived`, the valuation rule, §2), the fractions are summed per row and for the whole
  shop, and each figure is **rounded once** — `totalValue` is rounded from the exact sum, not
  from the rounded rows, so its closing figure **is** the stock value (smoke compares it with
  `/reports/stock-valuation`). "Sold" is at the lot's cost *today*; the profit report keeps each
  sale's frozen cost, so after a correction the two differ by exactly that correction — stated on
  screen. Values are absent, never zeroed, for other roles.
- **Margins stopped colouring under 3% amber** at the same time: in this trade 2–3% is ordinary,
  so most rows were amber and the colour marked nothing. Red for below cost stays.

### Growth: a month so far against the same days of last month (2026-10-08)

The owner: "one of the high points of Reho is to do a proper assessment of the business in
comparison to the previous months." Two things came of it, and the first was a bug.

**The bug.** Home's "▲/▼ on last month" set `sales.month` — this month **so far** — against
`last-month`, the **whole** of last month. On 8 October that was eight days against thirty, so
the arrow read about −74% on an ordinary month and only stopped lying in the last week. Nothing
in the code was wrong arithmetic; the two windows were different lengths. `sameSpanLastMonth`
(`period.ts`, where all date arithmetic lives) is the fix: from the 1st of last month to the
**same day and the same time of day** — 10:40 on the 8th against 10:40 on the 8th, so a
morning is set against a morning. A day last month did not have (the 31st against a 30-day
month) takes all of last month. `sales.changeBps` is now the growth revenue change, still 0 when
there is nothing to compare (the field's old meaning); the growth block says null.

**What grows, and how it is compared** (`reports/growth.ts`, pure): revenue, gross profit, gross
margin, operating profit, collected, number of sales, average sale, customers who bought, new
customers. Every money figure comes from the reports that already exist —
`ReportService.profit` and `collections` — so growth can never disagree with the profit report
for the same window. Three rules:

- **No comparison is null, not 0.** A first month, or one that sold nothing, has no change;
  "0%" would read as "flat".
- **A loss is measured on its size**, so a loss shrinking from ₦100k to ₦50k reads as up 50% —
  the direction it moved.
- **The margin moves in points.** 10.0% → 12.5% is "▲ 2.5 pts"; "up 25%" is true and useless.

**Customers** are named buyers (walk-ins are nobody in particular); **new customers** are those
whose first sale *ever* falls in the window, from one grouped read of each customer's first sale
per request, so twelve months cost one query, not twelve. A merged duplicate's sales moved to the
kept customer, so its history counts there.

**Two places.** Home's *Growth* table (`dashboard.growth`) is this month so far against the same
days of last month. *Reports → Growth* (`GET /reports/growth?months=6|12`, `SEES_COST` because it
carries gross profit) is month by month: each full month against the whole month before, and the
month under way against the same days — the comparison Home makes, so the two agree on the
current month. Six or twelve only; anything else is a 400.

**The first chart in the app** (`MonthBars`): plain HTML, no library. Revenue and gross profit
are **two charts rather than one with two scales** — on a 3% margin, gross profit drawn on
revenue's scale is a row of slivers, and a second axis is the classic way to make two unrelated
lines look related. One series each, so no legend; columns capped at 24px, rounded at the top and
square on the baseline; only the newest column carries its value, and hovering or focusing any
column shows its own. **The month under way is lighter, dashed and labelled "so far"**, because a
half-month column beside full ones reads as a fall — the same mistake the bug made in words. The
table beneath is the chart's figures in full, so nothing rests on reading a bar.

Not built: a same-month-last-year column, which waits for a year of records.

### Margins: today's price beside what the stock cost (2026-10-07)

The owner wanted to compare cost and price per item to decide prices — a vendor promo had moved
from "buy 19 get 1 free" to "buy 12 get 1 free", making every piece cheaper. `GET /reports/margins`
and *Reports → Margins*: **one row per product, in the biggest unit the till sells** (it was one
row per selling unit until the owner read it: the same 1.7% on a 1/2 pack, a pack and a carton,
three times over), on a chosen price list (default otherwise), thinnest margin first. **A projection to set prices by, not a record** — the profit
report still answers what was actually made.

- **The cost is the average of the stock on hand** — the owner's choice over "last delivery". It
  is valuation's rule (§2) per product: `Σ onHand × totalCost ÷ quantityReceived` over lots
  holding stock, divided by what is on hand, rounded **once** at the selling unit. A lot driven
  negative is left out rather than allowed to subtract. Free goods need no case: a 13-for-12 lot
  has one more piece for the same total. `Product.costPrice` is never read (§2).
- **With nothing on hand, the last delivery is the cost**, and `costFrom: 'last_delivery'` says so
  — a sold-out product still needs a price. With neither, the cost is null and so is the margin:
  never a zero, which would read as free goods.
- **The last delivery sits beside the average**, with its deal reduced to how a vendor says it
  (`dealOf`: 312 for 288 → "13 for 12"), because an average moves slowly — a new deal shows at
  once there even while the average catches up. "Delivery" means a lot with a receipt line, so
  opening stock and stocktake surpluses are not it.
- **The margin is on the price without VAT**, at the rate a sale would record today: the product's,
  or 0 for a shop that does not charge VAT — the same rule as `profit.ts`.
- **Services are left out** (`trackStock` off: no cost of goods, so always 100%), and so are units
  not sold at the till. Closed to `sales_rep` and cashiers (`SEES_COST`). The pure core is
  `reports/margins.ts`; nothing on the screen is computed.
- **A projection of the stock on hand** (same day, owner: "can we project the estimated profit
  with the current info?"): on hand × (price without VAT ÷ factor − exact cost per counted-in
  unit), per product and for the whole list, each part an exact fraction and every figure rounded
  once. **At the carton price** — asked, and chosen because the carton is usually the cheapest per
  piece, so smaller sales only add to it; the till's first unit would be the optimistic number for
  a wholesaler. Before expenses and salaries; a product with stock and no price is left out and
  counted (`unpriced`), never valued at zero. Follows the category filter and the chosen list.

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
| **Prisma's 5-second transaction limit, over a real network** (2026-10-07) | The owner could not save one invoice — a 500 twice, identical on retry. Every statement in an interactive transaction is a round trip, Render (Frankfurt) to the Supabase pooler (Ireland), and a delivery makes about six per line; a long invoice passed Prisma's default **5 000 ms** and was rolled back ("A query cannot be executed on an expired transaction"). Locally the database is next door, so nothing here ever came close, and smoke's deliveries have one or two lines. Confirmed with a 6 s transaction: fails on the default, passes at 30 s. The hosted log was not available, so the invoice itself is the inference | `TRANSACTION_LIMITS` on the client in `PrismaService` — `timeout: 30 s`, `maxWait: 10 s` — for every transaction at once; the three that already set their own keep it. And the forms most likely to be long (the till, a delivery) now **keep a draft in the browser** until saved, so a failure costs a retry, not a retype |
| **A smoke suite that only passes during business hours** | `npm run smoke` died at step 39 on a 403 from `POST /auth/login` — the **working-hours rule doing exactly its job**. A new organization defaults to 08:00–19:00, and every cashier sign-in after that point in the script inherits it, so an evening run failed on a feature that was working. The abort message named the window, which is the only reason it took minutes rather than an hour | The staff section now PATCHes the org to `opensAt: 0, closesAt: 1440` before the first cashier signs in. Nothing is weakened: the working-hours section further down still shuts the shop explicitly to test the refusal |
---

## 14. Where things stand

**Slices 0–6.6 done, plus the 6.1 gap-closing pass, two security passes, and staff
management and working hours. The web dashboard is complete: 7.0 through 7.6b are all done, every
route renders something real, and v1 is feature-complete. A first bug sweep against real use
followed on 2026-09-26/27 — eleven fixes, recorded in §18, two of which made whole screens
unusable and were invisible to every check in the repository. What remains before it ships is the
deploy at §15 item 1.** A second sweep followed on 2026-09-27, recorded in §19: a code-level pass
for the §18 classes repeated elsewhere — all of which held — which found that **signing in as a
`sales_rep` or `storekeeper` landed on an error screen**, and produced
`docs/MANUAL-TESTS-WEB.md`, the by-hand browser script §18 said was missing. 457 tests across
35 suites, twenty-four migrations, `typecheck`/`lint`/`build` clean in both trees, `npm audit` at
**0 vulnerabilities**, and `npm run smoke` green at 369 checks against a running server.

**Slice 7.6b — settings — landed 2026-09-26**, recorded in §17. It found a setting that could
lock out an entire shop: `PATCH /organization` accepted `workingDays: []`, which means *no* day is
a working day and refuses every sign-in. Owners are exempt and could undo it, but every other
member of staff would be shut out at once. Now refused, with a message saying what it would do.

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

**The immediate next thing is the deploy** — item 1 below. The web dashboard is finished and v1 is
feature-complete, so what is left before a shop can use this is putting it somewhere.

**Before that, the owner is testing the dashboard by hand**, which is the only check that has
ever found the two worst classes of bug in it (§18) — nothing here drives a browser. **The script
for that pass is `docs/MANUAL-TESTS-WEB.md`** (§19), 92 steps with `[gate]` markers; run
`npm run smoke` first, then walk it. Section J — signing in as a rep and a storekeeper and
repeating the walk — is the part most likely to find something, and is what the second sweep's
own bug came out of.

One thing is
left open from the first sweep and needs a decision rather than work: whether a decimal quantity
may be typed against a larger unit and converted in the browser. Also worth a sweep once a server
is up: in-house barcodes stored before the check digit was enforced are still unscannable, since
the check runs on write. The slice table and
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

1. **Deploy to Render**, decided 2026-08-30 — before buying a domain, since `*.onrender.com` is a
   working URL and a domain is a rename rather than a prerequisite. **`render.yaml` was written
   2026-09-29** (Postgres + **one** web service, region **Frankfurt** as the closest to Lagos),
   build `npm ci && npx prisma generate && npm run build && npm ci --prefix web && npm run build
   --prefix web`, start `npm run db:deploy && npm run start:prod` — migrations on boot, since
   `migrate deploy` is idempotent and there is no pre-deploy hook — and the existing
   `/api/v1/health` as the health check.

   ### One service, because `sameSite: 'lax'` decides the architecture

   This item was written before the dashboard existed and planned for the API alone. The obvious
   completion — a static site beside the web service — **would have shipped a deployment that
   could not hold a session.**

   Auth is httpOnly cookies set `sameSite: 'lax'` (`auth.controller.ts`), and the dashboard calls
   the API with `credentials: 'include'`. Two Render services are `dashboard-x.onrender.com` and
   `api-x.onrender.com`, and **`onrender.com` is on the Public Suffix List** — so those are
   different *sites*, not merely different origins, and a Lax cookie is not sent on a cross-site
   fetch. `COOKIE_DOMAIN=.onrender.com` cannot rescue it either: browsers reject a cookie scoped
   to a public suffix.

   **The failure would have been worse than an outage**, because it looks like success.
   `POST /auth/login` returns the tokens in the body as well as the cookies, so signing in would
   have appeared to work and every request after it would have answered 401.

   So the API serves `web/dist` from its own origin — `serveDashboard` in `src/main.ts`, using
   `useStaticAssets` plus an SPA fallback, with no new dependency since the app was already a
   `NestExpressApplication`. Three consequences worth knowing:

   - **The fallback runs before Nest's router**, because that is where plain Express middleware
     sits. It therefore steps aside explicitly for the API prefix and for `/docs` rather than
     relying on being reached last, and it **refuses paths containing a dot** so a missing
     `/assets/index-abc.js` 404s as itself. Resolving it to the HTML shell instead turns a failed
     deploy into a blank page with no error in it.
   - **`VITE_API_URL` is `/api/v1` in production** (`web/.env.production`) — relative, so the
     browser never makes a cross-site request at all.
   - **It survives a custom domain later**, which `sameSite: 'none'` would not have done: Safari
     blocks third-party cookies by default and Chrome is phasing them out. The two rejected
     alternatives are recorded because the cheap one is the one that fails in eighteen months.

   Verified against a running server on 2026-09-29: deep links (`/till`, `/sales/:id`) serve the
   shell, the API and Swagger are not shadowed, a missing asset 404s as JSON rather than HTML, and
   a login through the cookie jar alone answers `GET /auth/me` with 200.

   Four things already known about it:

   - **`NODE_VERSION` must be pinned.** There is no `engines` field in `package.json`.
   - ~~**`?connection_limit=5` on the database URL.**~~ — **corrected 2026-09-29, and it would
     have done nothing.** `connection_limit` is a **Prisma Rust query-engine** parameter, and this
     client does not use that engine: `PrismaService` goes through the `pg` driver adapter, whose
     pool is `node-postgres` and which takes its size from `max` in the pool config. `pg` does not
     recognise `connection_limit`, so the URL parameter is ignored and the pool quietly stays at
     its default of ten per process. The symptom would not have been a clear error but
     intermittent `too many connections` under ordinary load, against a plan that looked
     correctly configured. It is now `DATABASE_POOL_MAX` (default 5), passed as `max`.

     The general lesson: **advice carried forward from one library's configuration does not
     survive swapping the library underneath it.** The adapter changed; the note about tuning it
     did not.
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

### Vendor rebates: expected for a month, credited off a later bill (2026-10-05)

A vendor scheme pays a rebate when a month's buying meets its target, and pays it **only as credit
off a later bill** — never cash. Agreed with the owner before building: show "rebate expected"
with a tentative amount they enter (the vendor calculates the real one later), turn it "credited ✓"
when it lands on a bill, and count it in profit in the month it arrives, on its own line.

- **Not a payment, not an expense.** No money moves, so Money out never shows it and no bank
  account is involved; and booking it as negative expense or as revenue would bury what rebates are
  worth. It is a reduction in what one bill owes, which is exactly what `billBalance` already
  anticipated growing: `balance = amountDue − paid − rebated`. `CREDITED_REBATES` is the query
  half, and `rebates` is **required** in `BillBalanceInput` so that a balance query which forgets it
  fails to compile — the customer side once lost a void filter in a fourth `include` (§11).
- **Two steps, because the owner knows two things at two times.** `expectedAmount` when the month
  is earned; `creditedAmount` (the real figure, often different), `billId` and `creditedAt` set
  together when it lands — a CHECK constraint refuses half a credit. *Remove credit* clears all
  three: the bill owes again and the rebate is expected again.
- **No target gate.** Whether a scheme was met is the owner's judgement; schemes differ by vendor
  and encoding them is accounting software. The Targets page shows "2 of 3 targets met" beside the
  rebate as context only.
- **A credit never overpays a bill, and must be that vendor's.** The same rule as a payment, for the
  same reason: no allocation table on the vendor side (§16). A bigger credit goes on a bigger bill.
- **Profit counts it in the month of the bill it landed on** (`creditedAt` is the bill's
  `issuedAt`, so there is no date to type), as `vendorRebates` after gross profit:
  `operatingProfit = grossProfit + vendorRebates − expenses`. Gross profit and margin are untouched
  — the goods keep their invoice cost — so what the rebate is worth stays visible on its own line,
  on the dashboard too, since both read `ReportService.profit`.
- **One per vendor per month** (unique), editable while expected, removable while expected.
  Owner, manager and accountant, like everything else on the vendor side.

### Invoices and Bills, and every payment pointing at what it paid (2026-10-05)

Found in real use: a bill paid in full **vanished** from *We owe*, so there was no list of bills,
no "paid" on any of them, and no way to check that what went out matched what was billed. The
customer side had the same shape. The owner also asked for plainer, paired names.

- **The tabs are pairs.** Invoices / Money in for customers, Bills / Money out for vendors, then
  Expenses and Bank accounts (were *Owed to us / Payments / We owe / Paid out / Accounts*).
  Screen labels only: routes, endpoints, models and DTOs keep `receivables`, `payables`,
  `supplier-payments`, so saved links and the API are unchanged. Notes written before this date
  use the old names.
- **Unpaid and All, on both sides.** Unpaid is the grouped, longest-owed view it always was. All
  is `GET /supplier-bills` (which already kept settled bills) and `GET /sales?order=desc`. Each
  row shows Unpaid / Part-paid / Paid from `payState(balance, paid)` — **named from the server's
  `balance` and `paid`/`allocated`, never computed**, so the label cannot disagree with the
  figures beside it.
- **Mark as paid is not a new kind of write.** It is the ordinary payment form with the amount set
  to the whole balance; on an invoice the allocation is pinned to that invoice and capped at what
  it owes, so anything above becomes credit as everywhere else. Method and account are still
  asked — §11 forbids guessing them — and so is the day.
- **A bill lists the payments that add up to it.** `BillDialog` reads `GET /supplier-bills/:id`,
  whose payments are already only the live ones and whose `paid` is their sum; the only server
  change was adding each payment's bank account. A voided payment stays on Money out struck
  through and is absent from the bill. Money out links each payment to its bill; Money in links
  each allocation to its invoice, with the amount that went to it.
- **"Paid on" on both payment forms**, sent as noon UTC on the picked day (today sends nothing),
  so a bill paid in June but entered in October lands in June. The server already bounded
  `occurredAt` to a year back.

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
| 7.6b | Settings — organization letterhead, staff, working hours | **done 2026-09-26 — v1 is closed** |

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

### 7.6b, and a setting that could lock out the whole shop

Built 2026-09-26. The letterhead, opening hours and staff — the last slice of the dashboard, and
**v1 is closed**. Seven endpoints typed; 91 of 142 operations now declare a response.

**`PATCH /organization` accepted `workingDays: []`, and that locks every member of staff out.**
An empty list does not mean "every day" — `isWithinWorkingHours` asks whether today is in the
list, so an empty one refuses every sign-in there is. The DTO had `@ArrayMaxSize(7)` and no
minimum. Recoverable, because owners are never locked out and could put it back, but every
cashier, storekeeper and rep would be shut out at once with nothing on screen explaining why —
and the person who did it would have been ticking boxes on a settings form.

`@ArrayMinSize(1)` now refuses it with a message that says what it would do rather than naming a
constraint, and the hours form refuses it before the request. Worth noting **why it survived**:
the same field on `StaffHoursDto` *is* meaningfully empty — there it means "follow the business" —
so a reader comparing the two validators would have seen a deliberate-looking asymmetry. The
difference is that a membership has something to fall back to and the organization does not, which
is now written on both.

**The seat limit became readable.** `Organization.maxUsers` was not in `ORGANIZATION_FIELDS`, so
the staff screen had no way to say "4 of 5" and an owner would meet the ceiling only as a 409 on
the last field of a filled-in form. It is the pricing lever (§9), not a secret, and the check is
on adding and reactivating rather than on signing in — so the screen can say plainly that
everybody already there keeps working.

**Two forms stopped syncing state to props.** `BusinessPage` and `HoursPage` first seeded their
inputs from a `useEffect` on the fetched row, which is the pattern that fights whoever is typing
when a refetch lands. Each is now a loader that renders a child form once the data exists, so the
form mounts already holding its values and there is no effect at all. Keyed on the row id, so a
genuinely different organization rebuilds it.

**`ComingSoon` is gone**, which is the milestone rather than the change: every route in the
application now renders something real.

**Verified against the running server**: 38 checks. `currency`, `timezone`, `slug`, `maxUsers` and
`nextSaleNumber` are each rejected outright by `forbidNonWhitelisted` rather than silently ignored;
a letterhead field can be cleared back to null with an empty string as well as set; a window
crossing midnight is refused with a message about midnight; and a `sales_rep` reading `/staff`
gets names and roles but **no usernames, no contact details and nobody else's hours**, while still
being able to read the letterhead they issue invoices with.

**Still not verified in a browser** — no Playwright or headless Chromium here, so the wiring, the
arithmetic and the refusals are checked and the rendering is not. That gap now spans the whole
dashboard and is the first thing worth closing after deployment.

### Sorting by tapping a heading, and a price an owner was told they could not see (2026-10-07)

The owner asked for sorting "without having to narrow them down to categories… easy for laymen".
**Tap a heading**: first tap low-to-high, second high-to-low, third back to the screen's own
order; rows with nothing in that column always go last, so sorting by price never opens on a
page of blanks (`lib/sort.ts`, `SortHeading`). On Products, Customers (which gained a search box —
it had none), Margins and the report tables; `DataTable` sorts only columns that supply a
`sortValue`. Stock on hand is a list of cards with no headings, so it has a *Sort by* box.

**Not on the paged history lists**, and that is the rule rather than an omission: a table holding
one keyset page would sort the page and say something untrue about the rest. An *Oldest first*
switch for them was proposed and **not built** — `order=asc` on those feeds is the sync walk, which
ignores `until` and holds back the last second, so it needs a third, browsing-forward mode on four
endpoints the mobile app depends on. Its own branch if anyone asks twice.

**The bug found alongside it.** An owner saw "Not available for your role" on the products list's
*Base price*. Nothing was hidden: the catalog was priced by unit (an import does that), so
`basePrice` was **null** — and `<Money>` used one tooltip for null and for undefined. Undefined is
a key `redactCost` removed; null is a figure that does not exist. Only the first is about a role
now. And the column became **Price**: the default selling unit's price on the default list,
falling back to the base price *per counted-in unit*, never multiplied up in the browser (§17).

**Cost in the same unit as the price** (same day, owner: "for a wholesale store" cost per piece
beside a price per carton is no help). `ProductView.unitCosts` carries each unit's cost on the
last delivery, from the lot's exact total — `totalCost × factor ÷ quantityReceived`, rounded once.
Not `costPrice × factor`: `costPrice` is a rounded per-piece snapshot (§2), and multiplying it by
30 multiplies its rounding error by 30. It is a cost field like `costPrice` — listed in
`PRODUCT_COST_FIELDS`, and the lot query runs only for a role that may see cost. The products
list and the product page both read the unit from `lib/shelfPrice.ts`, so a carton price always
has a carton cost beside it. ~~(Margins, §12, still measures against the average of stock on hand
— a different question.)~~ **Changed the same day**: reading only the last *delivery* left every
product that had come in as **opening stock** saying "none yet" beside its price, while the stock
and margins reports valued it — the owner went looking for the cost they had seen before. Now
`unitCosts` is **the average cost of the stock on hand** (`averageUnitCost`, the margins rule,
opening lots included), falling back to the latest lot that received anything; the products
list, the product page and *Margins* show one figure for one product, and smoke checks the list
and the report agree.

**And the unit is the one the till picks first** (same day, owner: "use the till picks first unit
for both the cost and sales price"). The browser used to choose — the default selling unit, and
when that had no price, the base price per piece, which is a different unit from the one the till
would hand a cashier. Now the server sends `ProductView.tillUnit`: the unit from `tillFirstUnit`
(`catalog/selling-units.ts`, also what the till's search now calls, so there is one rule) and the
price `resolveUnitPrice` gives it on the default list, fallback included — exactly the till's
arithmetic. The default list is read off the product's own price rows (each carries its tier), so
the read costs no extra query; with no row on that list there was nothing to find there anyway.
The screens show that price and that unit's cost and choose nothing themselves.

### The till moved under Sales, and learned a date (2026-10-07)

**One section, two tabs.** Owner: the till "could be with the sale, since sale is just showing the
history". *Till* and *Sales* were two top-bar items; they are now one, *Sales*, opening on the
till, with **Till** and **History** tabs (`SalesLayout`, a pathless layout route). The addresses
stayed `/till` and `/sales` on purpose: `landingPath` sends a cashier to `/till`, and moving it
would have been a fourth place to keep in step (§19). The top-bar item lights up on both through a
`covers` list on the nav entry, since `NavLink` only knows its own path.

**A sale can be dated.** For typing in sales made earlier — a day's notebook entered the next
morning. `POST /sales` always accepted `occurredAt` (the mobile app sends its own clock offline),
and the sale, its payment, its stock movement and its due date already followed it; the till just
never sent one. `SaleDateBar` sends the picked day as noon UTC (`occurredAtFor`, the "Paid on"
rule), and nothing for today. Three choices worth keeping:

- **Owners and managers only, on screen.** A cashier's sale filed under last Tuesday puts today's
  cash-up out by exactly that sale. The server does **not** enforce it: an offline device
  legitimately syncs yesterday's sales as any role, and refusing old dates would break that. The
  year-back bound (`IsPlausibleOccurrence`) still applies to everyone.
- **The day stays picked between sales**, so a notebook goes in as a run — and the bar turns amber
  with the date spelled out and *Back to today* while it is not today, because forgetting it is the
  failure.
- **Prices are today's.** Nothing re-prices a cart to what a product cost last week; the seller
  types the price a line was actually sold at, which the till has always sent as `unitPrice`.

What it does **not** do is change the date of a sale already recorded. That would move a payment
between cash-ups and a stock movement between days in an append-only ledger — a correction, not
an edit, and its own decision if it is ever wanted.

---

## 18. The first bug sweep

2026-09-26/27, after v1 was feature-complete and before deploying. The shop owner used the
dashboard for the first time and reported what did not work. Eleven fixes; the ones worth keeping
are recorded here because each is a *class* of mistake rather than a typo, and most were invisible
to a compiler, a test and a code review alike.

### Two components fought the person typing into them

**`MoneyInput` re-formatted on every keystroke.** It rendered `(value / 100).toFixed(2)`, so
typing `3` stored 300 kobo and rendered back `3.00` with the caret at the end; the next digit made
`3.000`, which parses to the same 300 kobo. Every keystroke after the first was swallowed, and the
only way to enter 3,300.00 was to arrow back and type in front of it.

**It was also storing wrong prices, not merely being tiring.** Simulated over the old code:
`3300` lands on NGN 3.00, `250` on NGN 2.01, `1999.99` on **NGN 9.01** — each a figure the form
would happily save. The rule now: **a field shows the draft while it has focus and formats on
blur.** Anything that rewrites what you typed while you are typing it will fight you.

Three other boxes had the sibling fault — they committed only values they considered valid, and
the empty string is not valid, so backspacing snapped the old number straight back. `QuantityInput`
**filters to digits rather than validating**, so there is nothing to reject.

### A className that is concatenated is not an override

`Input` and `Select` baked `w-full` into their base classes and appended the caller's. Appending
does nothing: equal specificity means the rule Tailwind emits *later* wins, and it emits `.w-full`
(byte 9278) after `.w-28` (9164). **Every width any caller had ever passed was silently
discarded.**

Harmless in a stacked form, fatal in a flex row. The product form put a `flex-1` name box beside a
`w-28` factor box; the factor box claimed 100%, the row overflowed, and flex shrinking is
proportional to flex-basis — which for a `flex-1` item is zero. The name box shrank to **nothing**,
so units could not be named and a price could not be given a unit: a blank box that could not be
clicked, on the one screen where a product is defined.

`w-full` is now applied only when the caller has not set a width. Tailwind gives no warning when
one utility beats another, so this is worth checking whenever a component takes a `className`.

### Per-mutation cache lists cannot be kept right

Every write listed the caches it thought it affected, and **nearly every one listed the wrong
set** — recording a sale at the till invalidated nothing at all, so selling the last carton left
the stock screen still showing it. The list is a claim about what the *server's* write reached
while the person editing a screen is thinking about that screen, so the default is to under-list,
and the failure reads as a broken write: somebody records a payment, the balance does not move,
and they record it again.

`afterWrite` in `web/src/api/cache.ts` marks everything stale. Invalidation refetches **active**
queries only, so a write costs two or three small requests for data the person just changed. That
is worth more than the requests it saves.

### One rule, two implementations, two answers

`GET /receivables` reported a headline NGN 21,000 larger than its own per-customer breakdown.
`totalOutstanding` filtered credits out; `groupByCustomer` netted them away. One invoice paid in
full and then partly returned carried a balance of minus NGN 21,000, and the two halves disagreed
about what to do with it.

Netting was wrong on its own terms, not only inconsistent: **the walk-in bucket is not one party's
position**, it is several strangers' debts, and subtracting one stranger's credit from the pile
says something true of nobody. `splitOwed` now lives in `balance.ts` beside `saleBalance`, which
§5 already named as the one place this is decided.

### Endpoints that accept a parameter and ignore it

`GET /payments` took `since` and dropped it on the browsing path — the `desc` branch applied the
cursor and nothing else. A date filter would have done nothing, which is probably why the screen
never had one. It now takes `since`, `until`, `method` and `includeVoided`.

**The date bounds filter `occurredAt` while the feed stays ordered by `updatedAt`.** The feed walks
`updatedAt` because voiding mutates a row and a sync client must be told (§8); somebody filtering
"payments in September" means when the money moved. Ordering is a property of the feed, filtering
is a question about the money. `includeVoided` is **browsing-only** — letting a sync hide a void
would reintroduce the exact bug that ordering choice exists to prevent.

### Things the UI never offered

Three endpoints had no caller at all, and each absence was a hole rather than a tidy-up:

- **`POST /supplier-payments/:id/void`.** Void is the only correction on the vendor side — there
  are no negative payments (§16) — and a mis-keyed payment makes its bill look settled, so it
  drops off `/payables`. With no list of what had been paid out, the mistake was unreachable.
  Money gains a **Paid out** tab.
- **The barcode endpoints.** The product form's own comment had claimed "barcodes can be deleted"
  since the day it was written, and the markup was even laid out for a button that never arrived.
  Neither adding nor removing was possible.
- **`DELETE /products/:id`.** Labelled **Retire**, because that is what it does: a soft delete that
  leaves every past sale naming the product. "Delete" would promise something the system will not
  do and a shop should not want.

### Detail screens were dead ends

The frame only ever points at list screens, so an invoice, a customer and a delivery had no way
out but the top navigation — which reloads the list and throws away the filters that got you
there. `Page` now takes a `back`, which **steps through history** rather than to a fixed route, and
falls back to a named route when there is none: a pasted link has nothing behind it, and
`navigate(-1)` from there leaves the application.

### Cost is not something anybody types

The product form had an editable cost field. Every goods receipt overwrites `Product.costPrice`
with `totalCost / quantityReceived`, so a figure typed there survived until the next delivery and
changed nothing meanwhile — valuation and margins read lot totals (§2). It is now shown with where
it came from. **A box that accepts a number, ignores it and then forgets it is worse than no box.**

### In-house barcodes skipped their check digit

`detectSymbology` reads a 13-digit code beginning with 2 as INTERNAL, and `requiresCheckDigit` did
not list INTERNAL. An internal code *is* a real EAN-13 — that is why a scanner reads one — so
there was never a reason for a weaker rule. Unreachable until the form let a code be **typed**, and
the failure is nastier than a rejection: a scanner computes the check digit from the bars, so a
mistyped code sits in the catalog looking fine and never scans. Existing rows are not
re-validated, since the check runs on write.

### What a merge cannot work out

Merging `fix/retire-product` and `feat/product-page` conflicted in the product row. Keeping both
sides was not enough: the merged result needed `stopPropagation` on **Retire**, which neither
branch contained — on one the row was not clickable, on the other the button did not exist. A
clean auto-merge would have produced valid, compiling, wrong code.

### Open, and deliberately not done

- ~~**A decimal quantity in a larger unit.**~~ **Done 2026-10-06** with delivery corrections (§5):
  the delivery and correction forms take `6.5` against a carton and send the whole number of base
  units it is, refusing when it does not divide whole. No schema change, as proposed.

### Still true

**Nothing in the dashboard has been verified in a browser.** There is no Playwright or headless
Chromium in this environment, so across every slice the wiring, the arithmetic and the refusals
are checked and the rendering is not. Two of the bugs above — the collapsed inputs and the
unusable money field — were invisible to every check in the repository and obvious within a
minute of real use. That is the argument for the owner's testing pass being the real gate before
deploying.

---

## 19. The second sweep, and a written script for the by-hand pass

2026-09-27. A code-level sweep of all seventy dashboard files for the §18 classes *repeated
elsewhere* — they were fixed where they were noticed, not everywhere they occur — plus
`docs/MANUAL-TESTS-WEB.md`, which is the thing §18 said was missing.

**Everything in §18 held.** `controlClass` drops `w-full` when a width is passed; `MoneyInput` and
`QuantityInput` both hold a draft while focused; **every** write site calls `afterWrite` — 25
files, with only `AuthProvider` excepted and correctly so; all five detail screens pass `back`;
all four paged feeds send `order=desc`; both till price lookups pass `tierId`; no `fetch` outside
`client.ts`; no money arithmetic outside `lib/money.ts`. `jest` 457/457, both trees clean on
typecheck, lint and build.

### Hiding a nav item does not decide where somebody lands

**A `sales_rep` or `storekeeper` signed in and landed on an error screen.** `Layout` marks Home
`costOnly` and hides it from them, which is right — `GET /reports/dashboard` is
`@Roles(...SEES_COST)`. But **three separate paths sent everybody to `/` regardless of role**:
signing in with no intended destination, a role-guarded route turning somebody away, and a URL
matching nothing. All three landed on the one screen that fires the one request those roles may
not make, so the first thing a cashier saw after signing in was a red error box — and the nav had
no Home link to explain where they were.

It is worth noting what the *near miss* was. `RequireAuth`'s own docstring states the rule —
"routing them somewhere useful instead of into an error they cannot act on" — and its fallback did
the opposite for precisely the roles it turns away. **A correct rule written next to code that
contradicts it reads as verification.** Nobody re-checks a line with a comment above it saying
what it does.

The fix is one fact stated once: `landingPath(role)` in `auth/useAuth.ts`, which all three paths
now ask. A rep starts at the till and a storekeeper at stock, because that is what each of them
opens the app to do. `auth/Landing.tsx` holds the index route, which renders the dashboard when
the landing path *is* `/` — a comparison rather than a second reading of the role, so the two can
never disagree and the redirect cannot loop.

**`RequireAuth` is mounted once with no `roles` prop anywhere**, so its role branch is dead code
today. It was fixed regardless: the first route that needs gating will not think to look.

### A number input is a trap on a form

The one surviving `type="number"` was the product's reorder point. Two things wrong with it, both
silent: **a scroll wheel over a focused number input changes the value**, so scrolling the product
form past it edits a field nobody touched, and it accepts `2.5` against a column the server
requires to be a whole number of base units. Now digits are filtered, as everywhere else — and it
still holds a *string*, because blank has to stay possible and means "no reorder point".

### The script

**`docs/MANUAL-TESTS-WEB.md`** — 92 steps in dependency order with `[gate]` markers, mirroring
`MANUAL-TESTS.md` for the API. Its point is that the last sweep was whatever the owner happened to
click, so its coverage was unknown. Two sections carry most of the value:

- **Section J, the role pass**, is where the next findings are most likely. Every screen before it
  is checked as the owner, and the owner sees everything — the bug above existed because no
  by-hand pass had ever *started* as a rep.
- **Section K** is a ten-minute version of the §18 classes alone: type a long number into every
  money box digit by digit, backspace every number box empty, look at every row of side-by-side
  boxes, check the screen behind every write updates.

### Still true, still

**There is still no browser driver**, so this sweep checked wiring and reasoning, not rendering.
Adding Vitest and Testing Library to `web/` would let a pure rule like `landingPath` be tested —
the root jest config is scoped to `src` and `test` and deliberately cannot see `web/` — but that
is a toolchain decision rather than a fix, and it was not made here.

---

## 20. Nobody signs themselves up

2026-09-30, while preparing the deploy. The question that started it was narrow — *how do we
deploy without Resend?* — and the answer turned out not to be a different mail provider.

### The rule was never "mail must be configured"

`env.ts` refused to boot a production instance without `RESEND_API_KEY` and `MAIL_FROM`, and §9
recorded why: the `MailService` fallback writes verification codes and password-reset URLs into
the platform log in plaintext, which is an account-takeover path for anyone who can read logs.

That requirement was right, and it was also **one implementation of a more general rule**. The
rule is *no secret may reach a log*. Configuring a provider satisfies it by giving every minted
secret somewhere safe to go. Closing every path that can **mint** one satisfies it better, because
then there is nothing to leak rather than somewhere safe to put it.

So production must now be one of two honest shapes, and the third is refused at boot:

| `SELF_SERVE_SIGNUP` | Mail | |
|---|---|---|
| `true` | configured | fine — strangers register, codes get delivered |
| `false` | absent | fine — **nothing mints a code** |
| `true` | absent | **refused** — registering creates accounts whose codes go nowhere |

### Why this was available at all

**The dashboard has no sign-up screen.** Sign-in is the only auth UI — no register, no
forgot-password, no OTP entry. `/auth/register` exists in the API and nothing in the product calls
it, so turning it off removed a capability the product did not have.

It is worth being precise about what deploying *with* Resend would have bought. With no sign-up
screen, onboarding a shop would have been: call `/auth/register` with the owner's address, they
receive a code, they read it back to you, you call `/auth/verify-otp`. That is a worse version of a
script with a stranger in the loop. **The mail provider would have been infrastructure for a
funnel that does not exist**, and the go-to-market in `MARKET.md` is hands-on selling, not a
funnel.

### Checked in the service, not on the route

`assertSelfServeSignup()` lives in `auth/self-serve.ts` and is called from `register`, `resendOtp`
and `forgotPassword` — inside the service. A controller guard would have covered the three
endpoints that exist today; this covers the three *operations*, which is what the rule is actually
about. A future route reaching one of those paths inherits the refusal without anybody remembering
to decorate it.

That ordering is what `env.ts` is standing on. If any path could still mint a code with mail
unconfigured, the logging fallback is exactly the hole the original requirement closed.

**The fourth path is the one that gets missed.** Google sign-in creates a user and an organization
and **never mints a code**, so it would have sailed past a check aimed at the emailed routes. Both
of its doors are gated — no user, and an existing user with no active membership — while somebody
who already has an account and a business signs in untouched.

### The gap this uncovered: nobody could change their own password

There was no `change-password` endpoint. It had never mattered, because anybody who wanted a
different password could go the long way round through `forgot-password`.

Closing that route made the absence load-bearing: **a password handed to an owner at setup would
have been permanent**, changeable only by us running a script. That is not a product, and it would
have been discovered by a customer.

`POST /auth/change-password` is authenticated, demands the current password, and revokes every
session. The current password is required because **an access token is fifteen minutes of
authority and a password is permanent** — an unattended till, a borrowed phone or a session left
open on a shared machine all hand somebody a token, and none of them should be enough to take an
account away from its owner.

The general lesson: **turning a feature off tests whether anything was quietly depending on it.**
Self-serve password reset was carrying a job nobody had named.

### The CLI, and why it shares the seeding

`src/cli/admin.ts` — `create-org` and `set-password`, wired as `org:create` and `org:password`. It
boots a Nest application context rather than talking to Prisma directly, so it calls the real
`AuthService.createVerifiedOwner`, which shares `seedOrganizationDefaults` with registration.

That sharing is deliberate and has been paid for once already: Google sign-up used to create an
organization and stop, leaving businesses with no default price tier and nowhere to put a price
(§14). **A business created by hand must be indistinguishable from one that registered itself**,
or the accounts we create are subtly different from the ones we test, and the difference surfaces
in front of a customer.

Two rules about it:

- **Neither method has an HTTP route, and neither should get one.** `createVerifiedOwner` is
  `register` with the verification removed, and `setPasswordByIdentifier` is a password change
  without the old password — over the network that is account takeover with extra steps. Reaching
  the CLI already means holding the database.
- **The password is prompted for, never a flag.** An argument lands in shell history and in the
  process list.

### What this costs, stated plainly

- **You are the signup mechanism.** Fine at pilot scale, a ceiling at a few hundred shops.
- **You own owner password resets.** An owner who forgets theirs messages you. At ten shops that
  is arguably a useful support touchpoint; at two hundred it is a pager.
- **Running the CLI needs production database access** — the Render shell, or the external
  connection string on a laptop. Normal, but it is a real key on a real machine.
- **`npm run smoke` registers an organization**, so it cannot run against an instance with signup
  off. This makes two instances a requirement rather than a nicety: a test instance with signup on
  and `OTP_OVERRIDE` set, and production with signup off and no mail. §15 already assumed the test
  instance; this makes it mandatory.

And what it buys: the deploy stops being blocked on a domain purchase, DNS records and a provider
account, and two public unauthenticated write endpoints disappear along with most of the
account-enumeration surface.

**It is fully reversible.** Set the mail variables, flip the flag, redeploy — in one change,
because the boot check ties them together. No migration, no data change.

---

## 21. Supabase, and back to the free tier

2026-09-30, at deploy time. Two choices made together, and they turn out to depend on each other.

### The free tier has no shell, and Supabase is what makes that survivable

Render's SSH and dashboard shell are **paid-only**. §20 had just made an operator CLI the way
accounts get created, and the plan said to run it from the Render shell — which on the free tier
does not exist.

A Render free Postgres would have made that fatal: it is reachable only from inside Render, so
with no shell there is no way to reach the database at all. **Supabase is reachable from
anywhere**, so the CLI runs from a laptop against the same connection string the service uses.

Neither choice would have worked alone. Free tier plus Render Postgres has no route in; paid tier
plus either would have been fine. That is worth noticing because the two decisions arrived
separately and the dependency is invisible from either one.

### ⚠ The connection string is the trap

Supabase offers three, and **two of them are wrong here**:

- **Direct** (`db.<ref>.supabase.co:5432`) — **IPv6-only**. Render's outbound is IPv4, so this
  fails with `ENOTFOUND` or simply hangs. The symptom looks like a wrong password or a firewall,
  not like an address-family mismatch, which is what makes it expensive to diagnose.
- **Transaction pooler** (port **6543**) — IPv4 and fine for queries, but `prisma migrate deploy`
  fails against it with *"prepared statement does not exist"*. Migrations run on boot here, so
  this would fail every deploy.
- **Session pooler** (`aws-0-<region>.pooler.supabase.com:5432`) — **the right one.** IPv4, and it
  behaves like an ordinary Postgres connection, so prepared statements and migrations both work.

Session mode also happens to fit the shape this codebase already has. `prisma.config.ts` and the
runtime client both read `DATABASE_URL`, so **one string serves both** and there is no `directUrl`
to drift out of step — which is the usual Prisma-plus-Supabase failure, where migrations and
queries quietly point at different databases.

`DATABASE_POOL_MAX=5` (§15) turns out to be right for this too: session mode holds a real server
connection per client, so a small cap is what keeps a free project inside its allowance.

### What going back to free un-supersedes

§15 item 1 recorded free-tier consequences and then struck them through when the plan moved to a
paid tier on 2026-09-19. They are live again:

- **Cold starts**, ~50s after roughly 15 minutes idle. Tolerable for a pilot and genuinely bad at
  a till, which is the strongest argument for Starter ($7/mo) once a real shop is using it — that
  also restores the shell.
- **In-memory rate limiting resets on every cold start** (§15 item 0), which on this tier means
  routinely rather than rarely. Still close to harmless on one instance, still a blocker for two.
- **512MB of build memory**, against a build that runs two `npm ci` and two builds.

And one that is new, from Supabase rather than Render: **free projects pause after about a week of
inactivity.** A shop using it daily never notices; a demo left over a holiday does.

### The general shape

Both traps here are the same kind: **a default that is correct in the vendor's documentation and
wrong in this combination.** Supabase's own quickstart hands you the direct connection string, and
it works perfectly from a laptop on an IPv6 network. It fails only where this runs. Copying the
documented default would have produced a deploy that failed with an error naming neither Supabase
nor IPv6.

### A midnight job on a server that sleeps at midnight (2026-10-05)

`IdempotencyCleanupService` cleared stored write replies with `@Cron(EVERY_DAY_AT_MIDNIGHT)`. **On
Render's free plan the server is asleep at midnight** — it sleeps after ~15 minutes without a
request — so on a shop's quiet server the job never ran, and nothing cleared old sign-in sessions
at all. Measured locally, a stored reply is about a third of the space a sale takes (≈2.2 KB of
≈9 KB), and each person's session chain grows every fifteen minutes they work. Both piled up in a
500 MB database. Same shape as §22's trap: **a schedule that is right on a server that never
sleeps and silently absent on one that does.**

`HousekeepingService` (`src/common/housekeeping/`) replaces it: a sweep **30 seconds after every
wake-up** (out of a cold start's way, not awaited) and **every hour while awake**, never two at
once, never throwing. It clears replies past their 48 hours, and sign-in sessions **only a whole
chain at a time, once the newest token in it has expired** — a replaced token is kept while its
chain lives, because presenting it again is how `TokenService.rotate` catches a stolen session and
signs the chain out. First run on the development database cleared 301 dead session rows and left
every live chain alone; smoke stayed green.

### How far the free plans stretch (measured 2026-10-05)

Per row including indexes, from the development database: a product with three units and prices
≈ 3 KB; **a three-line paid sale ≈ 8 KB kept for good** (sale, lines, movements, payment,
allocation — the 48-hour reply copy comes and goes); a ten-line delivery ≈ 25 KB. Against
Supabase's free **500 MB**, one shop selling 50 a day lasts about three years, 150 a day about
thirteen months, 500 a day about four — shared between every shop on the instance. Database size
is on Supabase → Database. **Space is not what bites first**: Render's free plan sleeps (≈50 s
first request after a lull, which staff will feel every morning), and Supabase's free plan has
**no restorable backups** — take a `pg_dump` of the session-pooler URL weekly from a laptop until
the paid plan's daily backups take over.

**Starting the hosted database over** keeps the schema and its migration history and empties
everything else — tested in a rolled-back transaction, it emptied all 35 data tables and left only
`_prisma_migrations`:

```sql
TRUNCATE TABLE organizations, users RESTART IDENTITY CASCADE;
```

Then sign up again on the site. Product photos on Cloudinary are not touched.

---

## 22. Anyone can create their own shop

2026-10-01, before the first deploy. §20 closed self-serve signup so production could run with no
mail provider, and recorded the cost honestly: *"you become the signup mechanism."* The owner read
that and decided it was the wrong trade — shops should not have to wait on a person to be set up.

### Two questions that were being asked as one

`SELF_SERVE_SIGNUP=false` switched off `register`, `resend-otp` and `forgot-password` together,
and that was what allowed a mail-less deployment. It was right while **email was the only way to
sign up**. It stops being right the moment a shop can be created with a username, because the
single flag was conflating:

- *May a stranger create an account?* — a product decision.
- *Can this instance deliver an email?* — a configuration fact.

Username sign-up needs the first and not the second. So `auth/self-serve.ts` now has two guards.
`assertSelfServeSignup()` gates account creation — username sign-up, emailed registration, and
**both** doors of Google sign-in. `assertMailAvailable()` gates every path that mints a secret,
and answers **503 `EMAIL_UNAVAILABLE`** rather than 403: the caller did nothing wrong and the
answer may be different tomorrow.

`forgot-password` moved under the second guard only, which is more correct than where it was —
it is recovery, not signup, and it never belonged behind a signup flag.

### The invariant moved rather than weakened

`env.ts` no longer refuses to boot without a mail provider. That looks like a loosening and is the
opposite: the rule was never *"mail must be configured"*, it was **no path may mint a secret it
cannot deliver** — an account whose code goes nowhere is an account nobody can sign in to.

Before, that was enforced by a process-wide question at boot. Now it is enforced per request,
immediately before the secret is created, by the guard on the path that creates it. The bad
combination is impossible by construction rather than by configuration.

### ⚠ The trap this walked into, and what caught it

The first version defined "can deliver" as "a provider is configured". That closed `register` on
**every developer machine in the project** and took `npm run smoke` with it — smoke sets up its
organization through `register` and reads the code back out of the server log.

**Outside production the log *is* the delivery mechanism.** `MailService` writing the code to the
console is not a degraded fallback; it is the documented local loop. `canDeliverSecrets()` says so
explicitly, and two tests pin both halves.

The general shape is worth keeping: **a check that asks "is this configured" instead of "can this
succeed" will refuse the case where success arrives by a different route.**

### A username is plain for an owner, qualified for staff

`createVerifiedOwner` used to qualify an owner's username with the shop slug, exactly as staff
usernames are — `ade@adebayo-stores-f84554`. That is right for staff and wrong for an owner.

Staff usernames are qualified because an owner names their own people and two shops will both have
an `amina`; nobody types those by choice, they are handed over. **An owner picks their own at
sign-up and types it from memory every morning**, so it is globally unique instead, and they are
told at sign-up if the one they wanted is taken — the ordinary bargain everywhere else.

**Staff type just their name** (2026-10-07). The qualified form was right for storage and wrong
for a person: an owner added "Davidyo", and neither he nor the owner could sign in with it,
because the account was `davidyo@<shop>-<6 hex>` and the screen said only "do not match". Now a
plain name that is not itself a username is tried against every staff account named `name@…`
(`getStaffCredentialsByName`, the same allow-listed `select`, ten at most), and **the password
chooses**. Exactly one fits: signed in. Two fit — the same name *and* password at two shops —
and they are asked for the full username; that message can only appear to someone who already
knows a working password, so it reveals nothing a stranger could use. No fit is the usual
`Invalid credentials`; the rate limit counts every attempt as before. Usernames are still stored
qualified, so two shops can still each have a David.

### What this does not fix, and the form says so

**A shop owner with no email still cannot recover their own password.** Sign-up offers an optional
email for exactly this reason: nothing is sent to it today, and the day a provider is configured,
whoever filled it in can self-reset while whoever skipped it still needs us. That is on the screen
rather than discovered later, because it is their choice and they cannot reverse it themselves.

The CLI stays as the recovery path, and `POST /auth/change-password` (§20) stays as the ordinary
one.

### The kind of shop sets defaults, never features

Added 2026-10-03. Sign-up asks **what kind of shop it is** — `retail`, `wholesale` or `mixed`
(shown as "Both") — and stores it on `Organization.businessType`. It came out of the wholesale
units discussion: a distributor never sells the single piece, and should not have to say so on
every product it creates.

**It changes starting points, and locks nothing.** A wholesaler sometimes breaks a carton and a
retailer sometimes takes a bulk order; a type that hid features would turn both into a wall. What
it decides today is the price lists a new shop is seeded with — `defaultPriceTierRows` in
`price-tier.service.ts`, exactly one default each:

| Type | Seeded | Default |
|---|---|---|
| retail | Retail | Retail |
| wholesale | Wholesale | Wholesale — its walk-in is a trader |
| mixed | Retail, Wholesale | Retail — the customer nobody set up is a walk-in |

The units work that follows (§4) will read it for how a new product's units begin.

Four details:

- **Changing it later moves nothing.** `PATCH /organization` takes it (owner/manager, like the
  rest of that screen) and no price list is added or removed — a list with prices in it is not
  something to delete behind somebody's back. The settings screen says so.
- **Existing shops are `mixed`**, the column default, which is exactly how the app behaved before
  the question existed. Note they keep the single Retail list they were seeded with.
- **Optional on the wire, required on the screen.** An older client that never asks still signs
  up, as `mixed`; the sign-up form keeps its button disabled until a type is picked, because a
  default nobody chose is a default nobody notices. The emailed `register` path and Google never
  ask and get `mixed`; the CLI takes `--type`. On sign-up it is a **drop-down** reading *Choose
  one…* (changed 2026-10-04 at the owner's request — the form is already long on a phone), with
  the chosen type's description shown underneath; Settings keeps the three described cards.
- **It is not the subscription plan.** What a shop pays for stays `maxUsers` (§9). Tying
  features to the type would mean a wholesaler on a small plan could not sell cartons.

`SignUpInput` in the dashboard was a hand-written copy of the request shape; it is now the
generated `SignUpDto` type, because a copy is exactly where a new field gets forgotten while the
compiler stays quiet.


## 23. Archived CLAUDE.md notes (to 2026-10-08)

Until 2026-10-08 CLAUDE.md carried a paragraph for every slice and fix. At 1,100 lines it was loaded into every conversation and most of it was already here, so the rules that must not break stayed in CLAUDE.md and the rest moved below **word for word** — search it before changing an area. Section references inside (§2, §9 …) point to the sections above.

### Where things stood (the old CLAUDE.md section)

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
  margin by 7.5%. The dashboard reads lower than expected; that is it working. **Unless the shop
  does not charge VAT** (`Organization.chargesVat`, §2, 2026-10-05): off, every new sale records
  0% on its lines whatever the product's rate, so revenue is the whole price. It is frozen onto
  the sale like every money figure, so reports needed no change and switching rewrites nothing
  already sold. Existing shops start **on**, new shops **off**; a sale with no VAT prints no VAT
  line. One switch on purpose — not a tax setup.
- **One currency per shop** (§2, 2026-10-06): NGN by default, or USD, GBP, EUR, GHS, KES
  (`SUPPORTED_CURRENCIES`). Chosen at sign-up, with the time zone from the browser; **changeable
  in Settings only until a price, sale, stock movement, payment, bill or expense exists**
  (`currencyLocked`, 409 after), because every stored amount is a bare integer of it. A customer
  paying in another currency is recorded at what the shop accepted, foreign amount in the
  reference — never a second currency. On screen `<Money>` takes the shop's currency from
  `ShopCurrencyProvider`, so **never pass `currency` at a call site**; server messages naming an
  amount use `shopMoney`, never a literal `₦`.
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

**Vendor purchase targets are cartons of a category** (§12, reshaped 2026-10-04): `PurchaseTarget`
plus `GET /purchase-targets/report`, in `src/modules/reports/` — the only writes in an otherwise
read-only module. **A target is a vendor, a category, a month and a number of cartons** —
"112 cartons of lotion" — and any product filed under the category counts. **No product targets,
no money quotas, no units to pick**: vendors deal only in cartons, and what to buy within a
category is decided by stock and customers. Four rules are load-bearing: progress counts goods
**received**, not ordered; only what was **paid for** (`quantityPaidFor`), so free goods do not
advance it; **each product's carton is its biggest unit**, so a carton of 12 and a carton of 24
each count as one and a half-slot reads 9.5 (`cartonFactor`, pure, in `purchase-target.ts`); and a
product with nothing bigger than its base unit **has no carton and is named** in
`productsWithoutCarton`, never counted as pieces or skipped silently. **Editable** — cartons and
note only; vendor, category and month are what the target is. On `GET /reports/dashboard` as
`purchasing.targets`, one ring each on the home screen. The Targets tab is hidden for **retail**
shops (navigation only). The migration **cleared every existing target** — they were pieces, and
a category's pieces cannot be turned back into cartons.

**Beside them, one money target per vendor per month** (§12, 2026-10-06): `VendorMoneyTarget` and
`/purchase-targets/money` — "₦12M this month" from a vendor, **not per category** (the
per-category money quota stays gone). Progress is the **invoice value of goods received** from that
vendor in the month (`GoodsReceiptLine.totalCost`, so free goods add nothing), reported on
`GET /purchase-targets/report` as `moneyTargets` and on the dashboard as
`purchasing.moneyTargets`. **`addsVat` is a choice per target, default on**, because not every
vendor adds VAT: on, the target is before VAT and VAT comes off the month's total **once**, by the
same `splitTaxInclusive` a sale uses (`moneyProgress`, pure) — ₦12.9M of invoices meets ₦12M. The
Rebates panel shows it as context ("money target met"), never as a rule.

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

**Vendor rebates are a credit off a later bill** (§16, 2026-10-05): `VendorRebate` and
`/vendor-rebates`, in `src/modules/payables/`. A vendor pays a rebate **only as credit off a later
bill**, so it is **neither a payment** (no money moved — Money out never shows it) **nor an
expense**. Two steps: **expected** — vendor, month, a *tentative* amount, recorded on Reports →
Targets when the owner judges the month earned it (targets are shown beside it, never checked) —
then **credited** on a bill with the real figure (Bills → open the bill → Apply rebate), which
sets `billId`, `creditedAmount` and `creditedAt` together (a CHECK enforces it). Load-bearing:
**`billBalance` grew a term — `amountDue − paid − rebated`** — and `rebates: CREDITED_REBATES` is
**required** in `BillBalanceInput`, so any new query feeding a balance that forgets it will not
compile. A credit **bigger than what the bill owes is refused** (no allocation table on the vendor
side), and **must be that vendor's bill**. **Profit counts it in the month of the bill it landed
on** (`creditedAt` = the bill's `issuedAt`), as `vendorRebates` between gross profit and
expenses — not revenue, and not off cost of goods, so margins are untouched. One per vendor per
month; *Remove credit* puts the bill back to owing.

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
glyph; and **every active bank account is printed, default first**. **The invoice is A5, the
statement A4** (2026-10-06) — `INVOICE_PAGE` in `invoice.ts`; A5 saves paper only on a printer
loaded with A5 (§6).

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
are required in production *while self-serve signup is on*** (amended 2026-09-30 — see below),
because the log fallback writes OTPs and reset links in plaintext.
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

**The database is Supabase and hosting is Render's *free* tier** (decided 2026-09-30, superseding
the paid-tier note above). Three consequences are load-bearing:

- **Use the Supabase *session-mode pooler*, never the direct connection.**
  `aws-0-<region>.pooler.supabase.com:5432`. The direct host (`db.<ref>.supabase.co`) is
  **IPv6-only** and Render's outbound is IPv4, so it fails with ENOTFOUND or a hang — which reads
  like a bad password rather than a bad address family. The **transaction** pooler (port 6543) is
  also wrong: `prisma migrate deploy` fails against it with "prepared statement does not exist".
  Session mode behaves like ordinary Postgres, so **one string serves both** the runtime client and
  `prisma.config.ts`, with no `directUrl` to keep in step.
- **Render's free tier has no shell** — SSH is paid-only. So `dist/cli/admin` runs **from a laptop**
  against the Supabase URL, not from a Render shell. This is why Supabase rescues the free tier:
  a free *Render* database is internal-only and the CLI could never reach it.
- **Free means cold starts again** (~50s after ~15 minutes idle), which **un-supersedes** §15
  item 1's free-tier notes. It also means the in-memory rate-limit counters reset on every cold
  start (§15 item 0), and that Supabase free projects pause after about a week idle.
- **A server that sleeps never reaches midnight** (2026-10-05). The nightly clear-out of stored
  write replies never ran on the free plan, and nothing cleared old sign-in sessions at all.
  `HousekeepingService` now sweeps **30 s after every wake-up and hourly while awake**, removing
  replies past 48 hours and sign-in chains **only once their newest token has expired** (a replaced
  token in a live chain is what catches a stolen session). **Any new scheduled job must not rely on
  a time of day** for the same reason. Space per sale, how far 500 MB goes, backups and the
  one-line reset of the hosted database are in §21.

**`render.yaml` is written (2026-09-29, revised 2026-09-30): exactly one web service and no
`databases:` block, and the "one service" is load-bearing.** The API serves the built dashboard from its own origin (`serveDashboard` in
`src/main.ts`), because auth is httpOnly cookies set `sameSite: 'lax'` and **`onrender.com` is on
the Public Suffix List** — two services would be two *sites*, so the cookie would never be sent.
That failure looks like success: login returns tokens in the body too, so signing in would appear
to work and every request after it would 401. **Do not split them** without moving to a custom
domain with `COOKIE_DOMAIN` set. Three details: the SPA fallback is plain Express middleware so it
runs *before* Nest's router and must step aside for the API prefix and `/docs` explicitly; it
refuses paths containing a dot, so a missing asset 404s as itself instead of turning a failed
deploy into a blank page; and `VITE_API_URL` is **`/api/v1`** in production, relative on purpose.

**The product is called Reho** (decided 2026-09-29), short for **Rehoboth** — the owner's CAC
registered business name is *This Is Rehoboth*, so the entity and the product share a root and
there is nothing to license. It is deliberately a **house brand rather than a descriptive product
name**, because the loan app and the bank statement parser are queued behind this one: `Reho` can
carry all three, where a name describing stock control could not.

Two things about the root are worth keeping, because they are the brand's only real material.
**Rehoboth means "broad places" — room to grow** (Genesis 26:22, the well nobody fought over:
*"now the Lord has made room for us, and we shall be fruitful"*). That is a straight line to what
the product sells a shop owner, and it is where any tagline should start. And **the shortening is
load-bearing commercially, not only aesthetically**: Nigeria is roughly half Muslim and northern
FMCG distribution is real territory, so `Reho` travels where the full name carries a particular
signal. The decision to shorten was already right; this is why.

The repo stays `stock-mgt`; a repository name and a product name are allowed to differ and
renaming buys nothing.

**Anyone can create their own shop, with no email and no mail provider** (§22, 2026-10-01 —
superseding the 2026-09-30 note that closed signup). `POST /auth/sign-up` and the `/sign-up` screen
take a shop name, a name, a username and a password, create the owner and the shop, and sign them
in on the same request. `SELF_SERVE_SIGNUP=true` on the hosted instance.

**Two guards in `src/modules/auth/self-serve.ts`, because these are two questions.**
`assertSelfServeSignup()` asks *may a stranger create an account* — it gates username sign-up,
emailed registration and **both** doors of Google sign-in (the one that gets missed: Google creates
an account while never minting a code, so it sails past any check aimed at the emailed routes).
`assertMailAvailable()` asks *can this instance deliver what it is about to mint* — it gates
`register`, `resend-otp` and `forgot-password`, and answers **503 `EMAIL_UNAVAILABLE`**, not 403,
because the caller did nothing wrong. `forgot-password` is recovery, not signup, and now sits
behind the second guard only.

**`env.ts` no longer refuses to boot without mail, and that is a narrowing not a loosening.** The
rule was never "mail must be configured" — it is **no path may mint a secret it cannot deliver**.
That is now checked per request, immediately before the secret is created, instead of once per
process at boot.

⚠ **The trap, worth knowing because it is easy to repeat**: the first version defined "can deliver"
as "a provider is configured", which closed `register` on every developer machine and took
`npm run smoke` with it — smoke registers an org and reads the code out of the server log.
**Outside production the log *is* the delivery mechanism.** `canDeliverSecrets()` says so. The
general shape: **a check asking "is this configured" rather than "can this succeed" will refuse the
case where success arrives by another route.**

**Sign-up asks what kind of shop it is** (§22, 2026-10-03): `Organization.businessType` is
`retail`, `wholesale` or `mixed` ("Both"). **It sets starting defaults and locks no feature** — today
the price lists seeded (`defaultPriceTierRows`: Retail / Wholesale / both with Retail default), next
how a new product's units begin. Changing it in Settings moves nothing already set up and adds or
removes no price list. Existing shops, `register`, Google and a client that omits it get `mixed`;
the CLI takes `--type`. It is **not** the subscription plan — that stays `maxUsers`.

**An owner's username is plain; a staff username stays qualified by the shop slug.** Staff
usernames are qualified because an owner names their own people and two shops both have an `amina`
— nobody types those by choice, they are handed over. An owner picks their own and types it every
morning, so it is globally unique and they are told at sign-up if it is taken. **But staff sign in
with just their name** (2026-10-07): an owner added "Davidyo", who could not sign in — nobody types
`davidyo@shop-a1b2c3`. `AuthService.signInCandidate` tries a plain name as a username first (an
owner's), and if there is none, against **every staff member of that name** (`username` starting
`name@`), letting the **password** pick: one fits, they are in; the same name and password at two
shops gets "sign in with your full username". Every other failure is the same `Invalid
credentials`, and the login rate limit still counts each attempt. The Staff page shows *Signs in as
davidyo*, the full name on hover. **A customer can be removed** (owner/manager, `DELETE
/customers/:id`) only with **no invoices and no payments** — 409 otherwise, pointing at merging.

**Staff sell, take deliveries and count — nothing else** (§9, 2026-10-07, owner). `sales_rep` and
`storekeeper` may no longer **adjust or move stock** (`POST /stock/adjustments` and `/transfers`
are `INVENTORY_EDITORS` now; goods receipts stay open to them) or **take goods back**
(`POST /sales/:id/returns` is `TAKES_BACK`, owner/manager — a return pays money out and puts
goods on the shelf, so a made-up one walks off with either; "people are desperate"). Everything else — products,
prices, categories, price lists, places, vendors, opening stock, corrections, settings — was
already refused by the server; the screens just offered it. Now they hide it: no Add/Edit/Retire
on products, no *Places & vendors* or *Categories & tiers* tabs, no Adjust/Move on stock, no price
list on the customer form, and **Settings shows staff only *Your password***. A typed link into a
hidden tab lands on a page that works, and *Take goods back* is hidden on a sale.

⚠ **A shop owner with no email still cannot recover their own password.** The sign-up form offers
an optional email for exactly that: nothing is sent to it today, and the day a provider is
configured whoever filled it in can self-reset while whoever skipped it needs the CLI. The form
says so on screen.

Accounts are created **from a laptop, not from a Render shell** — the free tier has none — by
pointing `DATABASE_URL` at the same Supabase session-pooler string the service uses. They are
created with **`node dist/cli/admin create-org`** and recovered with
**`set-password`** (`src/cli/admin.ts`, npm scripts `org:create` / `org:password`). It boots a Nest
application context so it calls the real `AuthService.createVerifiedOwner`, which shares
`seedOrganizationDefaults` — a hand-made business must be indistinguishable from a registered one,
and the Google path already proved once what happens when it is not. Neither method has an HTTP
route and neither should get one: over the network, `setPasswordByIdentifier` is account takeover.

**`POST /auth/change-password` exists because of this** (authenticated, current password required,
revokes every session). With `forgot-password` closed, a password handed to an owner at setup would
otherwise be permanent and only we could change it. The current password is demanded because **an
access token is fifteen minutes of authority and a password is permanent** — an unattended till
should not be enough to take an account away from its owner.

**One thing must be set before the first deploy and cannot be committed:** the service name in
`render.yaml` is the hostname, so **rename it to the product's name before deploying**, not after.
Turning signup on later is a single change that must set the flag *and* both mail variables
together; the boot check ties them deliberately.

**`?connection_limit=` on the database URL does nothing here** — it is a Prisma Rust query-engine
parameter, and `PrismaService` uses the `pg` driver adapter, whose pool takes `max` from its
config. It is `DATABASE_POOL_MAX` (default 5). The older §15 note said otherwise and was wrong;
the symptom would have been intermittent `too many connections` against a plan that looked right.

On printing generally: thermal receipts (Bluetooth ESC/POS) are the mobile app's job — the server
cannot reach a paired printer — and `GET /sales/:id/receipt` is already the stable payload for
it. PDFs are the server's job. Barcode label sheets are deferred. See §6.

**Before declaring anything done, run `npm run smoke`** — `test/smoke.mjs` walks the whole API
against a running server. Its load-bearing check is that the sum of every stock movement equals
the sum of the stock levels; a sale that deducts wrongly breaks that and nothing else does.

The detail — what is verified against a running server, what is still outstanding, and the full
next-step list — is in [docs/DECISIONS.md](docs/DECISIONS.md) §14 and §15. This section is the
short version; that one is authoritative.

### The web dashboard (the old CLAUDE.md section)

Slice 7, planned in §17. **Vite + React + TypeScript**, with its own `package.json` — run
`npm install` and `npm run dev` from inside `web/`. It reaches the API over HTTP at `VITE_API_URL`
and shares no code with it.

**Where it has got to: 7.0 (foundation, sign-in), 7.1 (home), 7.2 (the till), 7.3 (sales, returns,
customers, statements, PDFs) and 7.4 (money — receivables, payments, allocation, void,
accounts, payables, supplier bills and payments, expenses), 7.5a (catalog — products, units,
prices, categories, packaging types, tiers), 7.5b (stock — on hand with its lots, deliveries,
the movement ledger, adjustments, transfers, counts, locations and vendors), 7.6a (reports —
profit, sales, purchases, collections, stock, movers, purchase targets) and 7.6b (settings — the
letterhead, opening hours, staff) are all done. **The dashboard is finished, every route renders
something real, and v1 is feature-complete. What is left is the deploy** (§15 item 1). The slice
table is in §17, and **§18 records the first bug sweep against real use** — eleven fixes, two of
which made whole screens unusable while every check in the repository stayed green.

**§19 records the second sweep** (2026-09-27), which re-checked every §18 class across all seventy
dashboard files — all held — and produced **`docs/MANUAL-TESTS-WEB.md`**, the by-hand browser
script §18 said was missing: 92 steps with `[gate]` markers, to be walked before deploying. Its
one real finding is the rule worth carrying: **hiding a nav item does not decide where somebody
lands.** Home is `costOnly` and correctly hidden from a rep, but three separate paths — sign-in
with no destination, a role-guarded route turning somebody away, and a URL matching nothing — all
sent everybody to `/` regardless, so a cashier's first screen after signing in was a red error
box. `landingPath(role)` in `web/src/auth/useAuth.ts` now states it once and all three ask it.
The near miss is worth more than the fix: `RequireAuth`'s docstring described the correct rule
while its fallback did the opposite, and **a correct rule written next to code that contradicts
it reads as verification** — nobody re-checks a line with a comment above it saying what it does.

**Two servers, two ports, and `start:prod` is not one of them.** `npm run start:prod` runs
`node dist/main`, which is the API alone — it serves `/api/v1` and Swagger on 4000 and does not
serve the dashboard at all. The dashboard is a separate Vite app: `npm run dev` inside `web/`, on
**5173, which is the URL to open**. `CORS_ORIGINS` already allows it. Use `start:dev` while
working, since `start:prod` needs a build first and will not pick up changes.

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
- **`<Money>` says "not for your role" only for `undefined`** (2026-10-07). `undefined` is a key
  `redactCost` removed; `null` is a figure that does not exist (no base price, no cost yet). The
  tooltip used to say it for both, and told an owner they could not see prices nobody had set.
- **Lists sort by tapping a heading — only where the whole list is on screen** (2026-10-07).
  `lib/sort.ts` + `SortHeading`: asc → desc → off, blanks always last. Products, Customers (which
  also gained a search box), Margins and the report tables (`DataTable` columns opt in with
  `sortValue`); Stock on hand is cards, so it has a *Sort by* box. **Never on a paged feed** —
  sorting one page misleads — and an oldest-first switch for those is not built: `order=asc` is
  the sync mode, which ignores `until` and holds back the last second.
- **A product's price and cost are for the unit the till picks first** (2026-10-07, owner).
  `ProductView.tillUnit` is that unit — `tillFirstUnit` in `catalog/selling-units.ts`, the same
  rule the till's search uses: the default selling unit, else the smallest sold — with the price
  `resolveUnitPrice` gives it on the default list (read off the product's own price rows, no extra
  query). The products list and product page show it ("₦12,500 / carton") and **cost in that same
  unit** from `ProductView.unitCosts`: **the average cost of the stock on hand, opening stock
  included — the margins report's basis** — else the latest lot that received anything, from lot
  totals, rounded once per unit — never `costPrice × factor`, which multiplies a rounded
  snapshot. (It read the last *delivery* until 2026-10-07, so products with only opening stock
  said "none yet" while the reports valued them.) `unitCosts` is a cost field (`PRODUCT_COST_FIELDS`,
  computed only for `SEES_COST`); `tillUnit` is not. The browser chooses no unit and multiplies
  nothing (`lib/shelfPrice.ts`).
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
- **Pay later is its own switch, not "0 against Cash"** (2026-10-06). On, the panel hides method,
  account, reference and amount, the button reads **Record sale on credit**, and the request is
  `{ amount: 0 }` with nothing else — the server writes no payment row and the invoice is owed. It
  still needs a customer, and **the rule that refuses more credit to a customer who still owes stays**
  (owner's decision, 2026-10-06): an owner or manager overrides with a reason, as before.
  `payingNow` in `till/payment.ts` is the one place that says what is paid now.
- **Every transaction may run 30 seconds, and long forms keep a draft** (§13, 2026-10-07). Prisma's
  default 5 s was rolling back long deliveries on the hosted pair (each statement crosses
  Frankfurt→Ireland) as a 500 — `TRANSACTION_LIMITS` in `PrismaService` sets it once. The till's
  cart and the delivery form are copied to `localStorage` (`lib/draft.ts`) until the server
  accepts them, **with the same sale/receipt id**, so a retry after a lost reply cannot record
  twice; leaving on purpose (Clear, Cancel) throws the copy away. The till also has **+ / −** per
  line, and the cursor returns to the item search after an item is picked or a line is set with
  Enter (`ScanBox` `focusKey` — picking a suggestion sends no request, so `busy` never fell).
- **A sale that looks already recorded is a warning, not a rule** (§6, 2026-10-08). The owner
  recorded a sale a member of staff had not, and nothing would have stopped it going in twice —
  an `Idempotency-Key` stops one device sending one sale twice, not two people recording one
  event. `POST /sales` now answers a sale with **the same customer on the same day** (the day
  it is dated, in the shop's zone), or **a walk-in within ten minutes**, carrying **the same
  items in the same amounts** — prices not compared — with a 409 `error: POSSIBLE_DUPLICATE`
  and `duplicates` (number, total, when, who recorded it). Checked **before anything is written**
  (`duplicates.ts`, pure). `allowDuplicate: true` is *Record anyway* — **any role**, no reason,
  the same `id` with a fresh key. The till's `DuplicateDialog` offers *Open it* (new tab, cart
  untouched), *Same sale — clear the cart* and *Record anyway*, and keeps `allowDuplicate` on
  for every later attempt at that sale (an override retry would otherwise meet the warning
  again). Sales → History gained **Recorded by** and the time. ⚠ **Smoke sends
  `allowDuplicate: true` on every sale unless a step says otherwise**: it repeats the same sale
  on purpose, and step 35's credit refusal was passing on the duplicate 409 instead — a 409
  test that does not check *which* 409 proves nothing.
- **The till sits under Sales, and can date a sale** (2026-10-07). One top-bar item, *Sales*,
  opens on the till, with **Till** and **History** tabs (`SalesLayout`); the addresses are still
  `/till` and `/sales`, so `landingPath` and saved links are untouched. **Sale date**
  (`SaleDateBar`, owners and managers only) sends `occurredAt` for an earlier day — the server
  already dated the sale, its payment, its stock movement and its due date from it, up to a year
  back. It **stays on the picked day** so a notebook goes in as a run, and turns amber with *Back
  to today* while it does. Prices are today's; a line's price can be changed.
- **A credit sale is due five days after it is made, and everybody sees who is due** (§6,
  2026-10-06). `Sale.dueDate` is **stored** — the start of the fifth day in the shop's timezone,
  set only when less than the total was paid (`dueDateFor`, `sales/due.ts`) — so changing
  `CREDIT_DAYS` moves future sales, never past ones. `GET /sales/due` lists what is overdue, due
  today or due in two days, owed-ness decided by `saleBalance` over `LIVE_ALLOCATIONS`, and is
  **open to every role on purpose**: the counter is where the customer walks in, and it carries no
  buying price. `DuePayments` shows it on **Home and on the Till** (folded there; hidden when
  empty), because Home is closed to a rep. All invoices has a **Due** column. A reminder, **not a
  rule** — nothing is refused for being overdue. **The same date reaches every report of a debt**
  (2026-10-06): `GET /receivables` carries `dueDate` and `daysPastDue` (so *Unpaid* and the
  customer page say "3 days overdue" rather than "8d"), the receipt payload carries `dueDate`
  (the invoice PDF prints **Payment due by**, the till's receipt too), the statement PDF's last
  column is **Due**, and the invoice download has a Due column. Each is null once nothing is owed,
  and an invoice with none falls back to its age. Words from `lib/due.ts` (`dueStatus`).

And three from 7.3:

- **`GET /sales`, `GET /payments`, `GET /supplier-payments` and `GET /stock/movements` each serve
  two readers.** `order=desc` is the browsing half;
  `asc` is the sync default and must stay that way. Walking forward, `since` is a starting position
  a cursor overrides; walking backward, `since`/`until` are plain filters applied beside the cursor.
  **Browsing also skips the one-second sync lag** — that lag stops a forward cursor stepping over a
  row still committing, and leaving it on made a just-recorded payment vanish from the list that
  refetched. Date bounds filter `createdAt`, so the screen is a ledger of what was *recorded* —
  reports use `occurredAt` and answer a different question.
- **PDFs go through `api.document`, never a plain link.** A raw navigation cannot run the refresh,
  so a link shows a JSON 401 instead of an invoice once the 15-minute token expires. Revoke the
  object URL on a timer, not immediately — immediately races the new tab. **`PrintButton`**
  (2026-10-05, on a sale and on the till's "Sale recorded") prints the same PDF from a hidden
  frame on a computer; **on a touch screen it opens the PDF instead**, because phone browsers do
  not reliably print a frame and the phone's own viewer has Print and Share.
- **A damaged return refunds money and writes no stock movement.** `restocked: false` means crushed
  goods never become sellable again, so the till must ask rather than default it.

Four from 7.4:

- **Void and refund must stay distinguishable on screen.** Both make an invoice owed again, so they
  look interchangeable — but a void says the money never moved and a refund is real money out that
  a bank statement will show. The void dialog says what a void *means* and offers the alternative.
  **Voided payments stay on the payments feed** (the audit trail) and **never appear on a
  statement** (the customer's position).
- **Allocation is two honest choices, never a guess.** Oldest-first, or exactly which invoice gets
  what. Over-allocating one invoice is a 409; money beyond the whole debt stays as credit. Note
  `allocateOldest` walks the *entire* list, so paying more than one invoice settles the next too.
- **The vendor side is not the customer side mirrored.** One supplier payment settles **exactly one
  bill** (no allocation table), there are **no negative payments** (void is the only correction),
  and overpaying is a **409** rather than credit. Those absences are decisions, not gaps.
  **"Paid on"** (2026-10-05, `PaidOnField` + `lib/paidOn.ts`, on both payment forms) lets a
  payment carry the day the money moved — for a bill paid long before it was entered. Today sends
  nothing; a past day is sent as **noon UTC on that day**, the same calendar day in every zone
  from UTC−11 to UTC+11, so the browser picks a day and never a period. The server already
  bounded it to a year back.
- **Invoices and Bills** (2026-10-05). The Money tabs are pairs: **Invoices** / **Money in** for
  customers, **Bills** / **Money out** for vendors, then Expenses and **Bank accounts** — they were
  *Owed to us / Payments / We owe / Paid out / Accounts*, and older notes here still use those
  names. Addresses did not change. Each side has **Unpaid** (the grouped, longest-owed view) and
  **All** (paid ones included), and every row carries **Unpaid / Part-paid / Paid** from
  `payState(balance, paid)` — named from the server's figures, never computed. **Mark as paid** is
  the ordinary payment form with the amount set to the whole balance (and, for an invoice, the
  allocation pinned to it); method and account are still asked. A bill opened (`BillDialog`)
  lists only the payments that count, so they add up to its `paid`; Money out and Money in link
  each payment to the bill or invoices it settled. `usePaySupplier` and `useRecordPayment` are
  the one write each side has.
- **A supplier payment is never an `Expense`.** Stock already reaches profit through cost of goods
  sold, so recording it twice understates every margin. The expense form says so on screen.
- **"Paid to" is a required typed name, and salaries have their own tab** (§11, 2026-10-06).
  `Expense.paidTo` replaced a vendor pick defaulting to "Nobody in particular". *Money → Salaries*
  records into the shop's one `ExpenseCategory` with `isSalaries` (seeded, backfilled, **never
  deletable**); `GET /expenses?kind=salaries|other` splits the lists. **Salaries stay an expense**
  — profit reports `salaries` and `otherExpenses` (summing to `expenses`) on separate lines and
  still subtracts both. No payslips, deductions or dividends.

And four from 7.5b, in `web/src/stock/`:

- **Any feed a person reads needs both walks, and the sync lag belongs only to the forward one.**
  `GET /stock/movements` was the fourth endpoint to need this after sales, payments and supplier
  payments — it is a checklist item now, not a discovery. `order` still defaults to `asc` so
  syncing clients are untouched.
- **Adjust and move are dialogs on a stock row, not screens.** You adjust *this product at this
  location*, which the click already said. Both inherit the till's override handling: a 409 is a
  rule, the reason *is* the override, and **the row id stays stable while each attempt carries a
  fresh key**.
- **Counting is not adjusting, and the screens say so.** A count changes nothing until an owner or
  manager posts it, and the sheet tells a counter that somebody else posts it. Counted quantities
  are **base units with no unit picker** — a person at a shelf counts pieces — while adjustments
  and transfers do offer one, because writing off "2 cartons" should not need multiplying first.
- **A surplus needs a lot, and an unvalued one reads as free.** Bringing stock on asks for the lot
  code, expiry and what it is worth rather than silently opening an empty batch. Deliveries say out
  loud that they raise a bill on *We owe* — the goods value on a receipt is not what is owed.

And three from 7.6a, in `web/src/reports/`:

- **The period picker sends a period *name*, never a date range.** Periods resolve in
  `Organization.timezone` (§6), so a browser working out "this month" from its own clock puts a
  Lagos shop an hour out of step with its own reports, silently and only near midnight. The window
  lives in the URL, so it survives a tab switch and a link to one report over one month is
  sendable. A custom range is the one case dates are sent, and the server still reads them in the
  shop's zone.
- **A duplicated type is a second chance to be wrong**, and the copy is the one nobody re-checks.
  `MoverRow` duplicated `SalesGroupRow` with `cogs` wrongly **required**; collapsing them made the
  compiler find the home screen printing `NaN%` against a field `redactCost` can remove.
- **Two server figures beside each other, never one subtracted from the other.** The collections
  screen shows collected *and* sold, because on a credit route they diverge — but the difference
  is not shown, both because money is displayed rather than computed and because that subtraction
  would be wrong: collections include payments on invoices from months ago.
- **Stock in and out, per product, for a period** (§12, 2026-10-07): *Reports → Stock* and
  `GET /reports/stock-summary` — **opening + delivered − sold ± adjusted = total** (the column was "At the end" until the owner renamed it), base units,
  by `occurredAt`, summed from the ledger with every movement in exactly one column
  (`columnFor` in `reports/stock-summary.ts`): opening stock entered in the period is *opening*,
  delivery corrections are *delivered*, customer returns come off *sold*, the rest is *adjusted*.
  Quantities are open to every role. Asked for because the owner read "Decisions somebody made"
  expecting deliveries in it — that list is hand-made changes only, and now says so. **In money
  too, for `SEES_COST`** (same day, owner: needed opening stock's value to check the books while
  records are few): each movement at **its own lot's exact cost**, summed exactly and rounded
  once, as `value` per row and `totalValue` for the shop — opening value + purchases − sold at
  cost ± adjusted = **the stock value** (smoke checks it equals `/reports/stock-valuation`). A
  *Quantities / Value* switch on the table and a reconciling line above it. "Sold, at cost" is
  at the lot's cost *today*, so after a correction it differs from the profit report's frozen
  cost by exactly that correction. Absent — never zero — for other roles. **Margins colours only
  a loss now**: the amber band under 3% coloured most of an FMCG list.
- **"Decisions somebody made" shows one line per item** (2026-10-07, owner). `auditLines` in
  `reports/auditLines.ts` adds up movements sharing product, place, reason and person — an
  opening stock entered as cartons plus loose pieces — keeping the latest time and an "N entries
  added up" note. **Forced movements are never merged**, each keeping its own reason; the
  *Movements* count still counts every movement. Counts, not money, so the screen may sum them.
- **Growth compares a month so far with the same days of last month — never all of it**
  (§12, 2026-10-08). Home's revenue tile used to set 8 days of October against 30 of September,
  so every month read as a collapse until its last week. `sameSpanLastMonth` (`period.ts`) is
  1st to the same day **and time of day** last month (a day last month did not have takes all of
  it). `GrowthService` builds every figure from the existing reports — revenue, gross and
  operating profit from `ReportService.profit`, collected from `collections` — plus a count of
  sales, named customers who bought, and **new customers** (first sale ever in the window, one
  grouped read per request). Pure rules in `reports/growth.ts`: a change is **null, not 0**,
  with nothing to compare; a shrinking loss reads as up; **the margin moves in points**.
  Home has a *Growth* table (`dashboard.growth`; `sales.changeBps` is now its revenue change);
  *Reports → Growth* (`GET /reports/growth?months=6|12`, `SEES_COST`) is month by month, each
  full month against the one before and this month against the same days — two bar charts
  (revenue, gross profit: **two charts, never one with two scales**, since profit is a sliver of
  revenue), a table and a download. `MonthBars` is the app's first chart: plain HTML, the
  month under way lighter and dashed with "so far".
- **Margins are a projection, at the average cost of the stock on hand** (§12, 2026-10-07).
  *Reports → Margins* (`GET /reports/margins`, `SEES_COST`) puts each product's price on a chosen
  list — **one row per product, in the biggest unit the till sells** (owner, 2026-10-07: a 1/2
  pack, pack and carton were three rows of the same margin) — beside its cost — valued from lot totals and rounded once, never `costPrice` — with
  the last delivery and its free-goods deal ("13 for 12") alongside. Nothing on hand falls back
  to the last delivery, **flagged**; no cost at all is null, never zero. Margin is on the price
  without VAT, as profit's is. Services and unsold units are left out.
  **It projects the stock on hand** (2026-10-07, owner): if everything on hand sold at today's
  **carton** price on the chosen list (owner's choice — usually the lowest per piece, so it errs
  safe), what it sells for, what it cost and the estimated profit — `projection` on the view and
  `projectedProfit` per row, exact parts summed and rounded once (`projectSale`,
  `projectionTotals`). Before expenses and salaries; products with stock and no price are counted
  as `unpriced` and left out, and the screen says so.

And three from 7.6b, in `web/src/settings/`:

- **An empty `workingDays` on the organization locks every member of staff out**, and the write
  path used to accept it. It means *no* day is a working day, not "every day". Now
  `@ArrayMinSize(1)`, and the form refuses it first. **Note the asymmetry**: the same field on a
  *membership* is meaningfully empty and means "follow the business" — a membership has something
  to fall back to and the organization does not.
- **Seed a form by mounting it with the data, never by `useEffect`.** A loader that renders a
  child form once the row exists has no state to sync, and cannot fight somebody typing when a
  refetch lands. `BusinessPage` and `HoursPage` are both that shape.
- **Letterhead fields are cleared with an empty string, not by omitting them.** Omitting means
  "leave alone", `''` means "clear", and a settings form has to be able to do both.

And six from the first bug sweep (§18), which are the ones most likely to be reintroduced:

- **A field must never rewrite what you are typing.** `MoneyInput` re-formatted on every
  keystroke, so it swallowed every character after the first *and* stored wrong prices — `1999.99`
  became ₦9.01, which the form then saved. Show the draft while the field has focus, format on
  blur. `QuantityInput` is the same idea for whole numbers: **filter to digits rather than
  validating**, because a validator that rejects bad values also rejects the empty string and so
  cannot be cleared.
- **A `className` prop that is concatenated is not an override.** `Input` and `Select` baked in
  `w-full` and appended the caller's width; Tailwind emits `.w-full` *after* `.w-28`, so every
  width ever passed was discarded and a `flex-1` box beside a full-width one collapsed to zero.
  Tailwind never warns about this. `controlClass` in `Field.tsx` now drops `w-full` when a width
  was supplied.
- **A write invalidates everything, through `afterWrite`.** Per-mutation cache lists were wrong at
  nearly every call site — the till invalidated nothing at all — because the list is a claim about
  what the *server's* write reached while the author is thinking about one screen. Refetching is
  limited to active queries, so the cost is two or three requests for data the person just
  changed.
- **Two figures on one screen need one implementation.** `GET /receivables` disagreed with its own
  breakdown by a returned invoice, because the headline filtered credits out while the grouping
  netted them away. `splitOwed` in `balance.ts` decides it once (§5). Netting was wrong on its own
  terms too: the walk-in bucket is several strangers' debts, so a credit taken off the pile is
  true of nobody.
- **Detail screens need a `back`, because the frame only points at lists.** `Page` takes one; it
  steps through history so filters survive, and falls back to a named route when there is none —
  a pasted link has nothing behind it.
- **Cost is never typed.** Every goods receipt overwrites `Product.costPrice`, so an editable cost
  box takes a number, ignores it and forgets it. Show it with where it came from and say to record
  the delivery instead.

**In-house barcodes are validated like any other EAN-13.** A 13-digit code starting with 2 reads
as `INTERNAL`, which used to skip the check digit — harmless while every such code was generated,
and a trap the moment one could be typed, because a scanner will never produce a mistyped string
and the code simply never scans. Existing rows are not re-validated.

**Units, prices and barcodes upsert and never delete what a request does not list** (§4), and the
product form must not imply otherwise — a remove button on a *saved* row would silently do nothing.
A row added in the form and **not yet saved** has a × that really removes it (2026-10-02), because
it exists only in the form; a mistyped "Add unit" used to have to be saved and lived with. Units can be
added and their `factor` changed (safe, because `SaleLine.unitFactor` is a snapshot), but **never
deleted** and **the base unit never moves**, since stock is counted in it. Prices cannot be deleted
at all: an unpriced unit falls back to `basePrice × factor`, which is the carton overcharge §4
exists to prevent. Barcodes *can* be deleted.

**Counting is not selling** (§4, 2026-10-03). The base unit is what stock is **counted in** — the
smallest piece that can be left on a shelf — and the form calls it that. `ProductUnit.isSellable`
says whether the till offers a unit: Peak 14g is counted in sachets because half a carton leaves
half a roll behind, and a distributor never sells a sachet. Rules in `catalog/selling-units.ts`: a
wholesaler's base starts unsold, a product's only unit is always sold, at least one unit must be
sold, and **exactly one sold unit is the default**, settled after every unit write. **Only selling
checks it** (`resolveProductUnit` with `forSale`, which also picks the default selling unit rather
than the base when no unit is named); deliveries, counts, adjustments and returns use every unit.
The form sends `isSellable` only for a box somebody touched, so the server's default is the one
stored.

**A portion is a unit** (§4, 2026-10-03). *Add a portion* on the product form makes `1/2 carton`,
`1/6 carton` and so on as ordinary units with their own factor and price — never a fractional
quantity, so the ledger stays whole. The form refuses one that is not whole (*"½ of a carton is
10 and 1/2 rolls"*) and names it with a slash, not `½`, because the PDF fonts have no ⅓ or ⅙.
The arithmetic is in `web/src/lib/portions.ts`.

**No base price means no fallback** (§4, 2026-10-03). `Product.basePrice` is nullable; with none,
a unit without its own price has `price: null` from `resolveUnitPrice` — the one pricing rule, now
also used by scans — and the till refuses it rather than guess. A seller-named `unitPrice` is still
accepted. Zero is a price; null is not.

**The phone is the scanner** (§4, 2026-10-04) — staff may have only a phone. `CameraScanner`
(`web/src/components/`) uses **ZXing, lazy-loaded** (iPhones have no `BarcodeDetector`). At the
till it stays **open until Done**, beeps per read, ignores the same code for 2s, and shows the
line just scanned for unit and quantity; the text box is disabled meanwhile so the phone keyboard
stays down. In **Add product** each unit has a barcode box with a camera button and the codes ride
in the same `POST /products` — no separate registration. Cameras need https (or localhost).
**A price read with no tier uses the default tier** (`resolveTierId`) — scan, price lookup and till
search alike; "no tier" used to mean the fallback, which can now be no price at all.

**The till suggests as you type, in one request** (§4, 2026-10-04). Picking an item cost three
round trips in a row — about ten seconds on Render's free tier, where every request is one to two
seconds; the database was never the slow part. `GET /products/till-search` returns matching
products with **sellable units already priced on the cart's tier**, asked after two characters and
a 250ms pause, so tapping a suggestion adds it with no request. **Enter with nothing highlighted
still tries a barcode first** (scanners press Enter); arrows highlight, Escape clears. The route is
declared **before** `products/:id`, or `:id` swallows it.

**Picking a customer on another tier re-prices the whole cart** (§4, fixed 2026-10-04 — the
docstring promised it from the till's first version while only new lines moved). `applyRepricing` in `till/cart.ts`:
a typed price stands, a line the new list cannot price keeps its old price **and is named**, a line
that changed unit mid-flight is left alone. Payment is disabled while prices move, and a run
counter lets only the latest customer choice land.

**A customer can be added from the till** (2026-10-05): **+ New** beside Customer opens the same
`CustomerDialog` as the Customers screen, cut down to **name and phone only**, and the new
customer is chosen for the sale at once. **No price list at the counter, on purpose**: shops here
price the item, not the buyer — the wholesale price is the carton's or the 1/5 carton's own price —
so asking what kind of customer somebody is has no place in a queue. The cart keeps its prices.

**Duplicate customers are headed off, and merged when they happen** (2026-10-07, owner found the
same shop twice with invoices under each). `CustomerDialog` offers up to five **existing matches as
a name or phone is typed** (every typed word in the name; a phone matches on its last ten digits)
— *Use* at the till puts the sale in their name, *Open* on Customers opens them — and a phone
already on file turns the button into **Add anyway**: it warns, never refuses, since two people
can share a name. `POST /customers/:id/merge` (owner/manager) moves every **sale and payment** of
the duplicate onto `intoCustomerId` — the only two tables that point at a customer, and balances
are derived from them — copies a phone, email or surname the kept one lacks, and soft-deletes
the duplicate with `mergedIntoId`. ⚠ Sales sync on `createdAt`, so a device that already synced a
moved invoice would keep the old name; no such device exists yet, and the mobile app must handle
it. *Same as another customer?* on the customer page opens it.

**Sales → History**: the whole row opens the sale, and each row has **Print** (the invoice PDF,
`PrintButton`), so a reprint needs no second screen. **Home** pairs what moved with what is owed:
*Paid this month* (customers, `collections.month`) · *Unpaid invoices* · *Unpaid bills* · *Bills
paid this month* (`purchasing.payables.paidThisMonth`, live supplier payments by `occurredAt`).
**Paid and uncollected each say their share of the month's sales** (§12, 2026-10-07) —
`paidShareBps` / `uncollectedShareBps`, against sales **with VAT** (`monthGross`), because that is
what the two add up to; uncollected is `10000 − paid` so they make exactly 100%; paid may pass 100%
(older invoices); no sales is null, never 0%. The first row ends **Revenue this month** · **Cost of goods
sold** (`cogsShareBps`, exactly `10000 − marginBps`) — *Uncollected this month* was **removed**
(owner: it read as the same as *Unpaid invoices*; the server still sends it). The profit row reads
Gross profit · **Expenses** (`expensesShareBps`, salaries included) · Operating profit
(`operatingMarginBps`) · **Goods available for sale** — `dashboard.stock`, opening +
delivered at cost for the month, from the same `StockSummaryService` walk as Reports → Stock
(`availableValue`, summed exactly and rounded once). It is what the shop *handled*, not what is
left — that is the **Inventory valuation** on Reports → Stock (renamed from "What the stock is
worth"). A wider pass to standard accounting terms is planned **after the remaining bugs**.

**Staff are signed in on one device at a time** (§9, 2026-10-07, owner). Signing in ends every
other session of that person (`signsInOnOneDevice` in `token.service.ts`, asked by
`issueForUser` and `switchOrganization`) — so a shared or stolen staff password shows itself:
the real person is thrown out. Owners and managers keep several devices. The other device is out
**at once** since 2026-10-08 (it was "within 15 minutes"). A refresh token revoked on purpose and
never replaced answers *This session has ended* rather than being logged as token theft.

**The owner sees who is signed in, and can sign somebody out** (§9, 2026-10-08).
`GET /staff/sessions` (owner, manager) reads the refresh-token chains already recorded — nothing
new is collected, and **no IP address leaves the server** — and `staff/sessions.ts` (pure) names
each device from its user agent ("Chrome on Android") and decides **active now = renewed in the
last 30 minutes**, because a live token outlives a closed browser by days. Settings → Staff shows
*Signed in · device · since 8:12 · active 4 min ago* or *Not signed in now · last seen …*, and Home
says *N people signed in now, on M devices · See who* (`dashboard.signedIn`, the same count).
**Sign out** (`POST /staff/:userId/sign-out`, owner only, not yourself) ends their sessions in
*this* shop and leaves another business's alone; it is not suspension — they can sign straight
back in. **Ending a session is immediate**: `TokenService.endSessions` revokes the refresh tokens
*and* sets `Membership.sessionsEndedAt`, which `JwtStrategy` (already reading the membership on
every request) checks against the token's **`iatMs`** — a millisecond issue time every access
token now carries, because the standard `iat` is whole seconds and smoke's two sign-ins inside one
second slipped past a seconds-based cut. ⚠ **Any new path that ends sessions should call
`endSessions`**, not `revokeAllForUser`, or the other device keeps working for fifteen minutes.

**`Product.size` is plain text** (§4, 2026-10-02) — `400g`, `33cl` — set on the product form and
shown read-only beside the name on the products list, the till and the receipt (its own `size`
field there, never folded into `description`, so older printers keep working). Not on PDFs. Blank
is stored as null; on an edit, omitted leaves it and `''` clears it; search matches it. The
products list also shows **On hand**, summed from one `GET /stock/levels` and said in the shop's
units — "14 carton, 2 roll, 5 sachet" — by `describeCount` (`web/src/lib/quantity.ts`), skipping
`1/2 …` portions, exact count on hover. Display only.

**A category in use cannot be deleted** (§4, 2026-10-02). `DELETE /categories/:id` is a 409 naming
the count while any product — retired ones included — or sub-category is still in it; leaving the
products pointing at a hidden row makes three screens disagree, and clearing `categoryId` rewrites
past reports. Re-adding a deleted name **revives** the row, as packaging types already did, since
the soft delete keeps the name under the unique constraint. Packaging types stay deletable while in
use, on purpose. Both now have a Remove button on *Categories & tiers*; price tiers do not.

**A category can be added from the product form** (2026-10-05): **+ New** beside Category
(`catalog/CategoryPicker.tsx`) adds it and picks it without closing the form. It sits *inside* the
product form, so **Enter is caught on the box** — otherwise it saves the product with the category
still missing. A name already on the list is picked rather than sent, and **the id the server
returns is the one used**, because re-adding a deleted name revives the old row with its own id.

**Screens download as Excel** (§17, 2026-10-05): products (in the import template's columns, so
the file *is* the template filled in), stock on hand, every report (a tab per table), and the four
money lists — all invoices, all bills, money in, money out — for an accountant. `lib/exportSheet.ts`
+ `DownloadButton`. **Light on purpose**: `write-excel-file` is imported on the first download,
never with the page (~15 KB gzipped, its own chunk), and a download reads only what the screen
already reads — the money lists walk the same endpoint at its largest page. **Nothing is
computed**: money is the server's kobo shown in naira as `<Money>` does, margins are basis points
shown as a percentage, a field `redactCost` removed is an **empty cell, never 0**, and barcodes and
SKUs are **text** so Excel cannot round them. Stock on hand carries counts, not value — value is
the Stock report's download, where the server values lots from their totals.

**Add product asks "Already on your shelves?"** (§5, 2026-10-08): an optional quantity, unit
(biggest by default; decimals that come to whole pieces), cost of **one** of that unit, expiry and
— with several places — where. **No server change**: the form `POST`s the product, then the same
`POST /stock/opening` the Opening stock screen uses, so it is an opening balance — no bill, no
vendor target. Only when adding, for a stocked product, to a role that sees cost. ⚠ **Two requests,
so the form keeps the saved product**: if the stock half fails it says the product *is* saved,
the button becomes *Save opening stock* and retries **only the stock** (the product id is minted
once), and Cancel becomes Close — a retry that re-sent the product would add it twice.

**Opening stock is an opening balance, never a delivery** (§5, 2026-10-05): *Stock on hand →
Opening stock*, `GET`/`POST /stock/opening`. A delivery raises a bill and counts toward vendor
targets, so day-one stock entered that way put a debt settled in June onto *We owe*. Each line is
an `opening_balance` lot valued at **cost per unit × quantity (cost required)** with
`quantityPaidFor: 0`, so no bill, target or purchases report sees it. **Only products that have
never had stock come in at that location are offered**, and the save re-checks in its
transaction, so it cannot be entered twice; a product sold before it was counted still appears.
Bulk-written by `StockService.recordNewLots`, which keeps every ledger write in one service.
**A line's quantity may be a decimal in its unit** (2026-10-07) — 6.25 cartons is one line, not
cartons plus a "loose" line — as long as it comes to whole counted-in units (`planOpeningStock`
refuses 2.25 rolls of 10; the form says so first, with `toWholeBaseUnits`). The lot is still
whole base units; the total is `unitCost × quantity` **rounded once**. The cost box names its
unit permanently, and **changing a line's unit clears its cost** — a carton's cost kept against
a piece valued the lot twelve times over, silently. **An opening lot's cost can be corrected**
(2026-10-07): *Stock on hand → expand → Correct cost* on a lot with `isOpening`, owner/manager,
`POST /stock/opening/lots/:batchId/cost` (and `/preview`, which writes nothing, so the screen shows
the new total from the server). The cost is for one of a chosen unit; the lot's total becomes
`unitCost × quantityReceived ÷ factor`, rounded once. **Only the value changes** — quantity and
movements stay, sales already made keep their cost — and a `LotCostCorrection` keeps before, after,
who and why (reason required). A delivered lot is a 409: deliveries are corrected through their
receipt, which also moves the bill. Found when 3 opening pieces entered at a pack's cost pushed a
lotion's average carton cost from ₦48,376 to ₦50,114.

**A catalog can be imported from a spreadsheet** (§4, 2026-10-05): `POST /products/import` and
*Products → Import from spreadsheet* — template, upload `.xlsx` or `.csv`, preview every row, then
save all or nothing. One row per product: counted-in unit and price, **as many bigger units as
the row has** (Unit 2, 3, 4 … — the export writes that many, so it must read them back), category
by name, one barcode. **A unit named "1/2 carton" is a portion** whose "how many" may be left empty
— worked out from the carton in the same row, refused when not whole — and **a unit with a price is
sold at the till while one without is counted only** (fixed 2026-10-05 after a real sheet: a lotion
carton of 12 sold only as 1/2 and 1/4 had nowhere to say so, and every row failed on two units both
called "carton"). No prices at all falls back to the form's defaults. **Every cell travels as text and the server
reads it** (`parseNaira`, exact), and **the preview and the save are the same `planImport`**, so
they cannot disagree. A product is **its name and size together** (`productKey`) — *Dry Impact* 50ml
and 200ml are two — and one already there is **skipped, never changed**; no cost, no opening
stock, no price-list column. ⚠ **A path-scoped body parser must not be named `jsonParser`**:
Nest skips its own global JSON parser if it finds one by that name anywhere, and every other
request arrives empty — see the wrapper in `main.ts`.

**A service is a product with `trackStock` off, never a category** (§4). A delivery charge is
priced, taxed and invoiced like anything else; the sale path returns the line without calling
`recordOutbound` and records `costOfGoodsSold: 0`, and reorder alerts, stocktakes and stock
operations all exclude it. `Category` groups things for *reporting* and is orthogonal — one
*Services* category is worth having if that revenue deserves its own line, and a "Goods" category
opposite it is worth nothing. **The consequence: a service shows a 100% gross margin**, because
the driver's fuel and time are an expense rather than cost of goods. Set a base unit (`trip`,
factor 1) and the VAT rate deliberately — `taxRateBps` defaults to 7.5% and is per product.

**Quantities are integers everywhere, and half a carton is six pieces.** Typing `0.5` is refused at
three layers on purpose. Stock lives in base units, so a fraction of a bigger unit is a whole
number of smaller ones — switch the unit. Divisible goods (rice, oil) want a *finer base unit*, not
a decimal column; making `quantity` decimal is a migration across five tables that puts a
non-integer into the ledger smoke's sum-check depends on. Full reasoning in §15.

The real case this meets is **buying**: "half a slot" means paying for 9.5 cartons and receiving
10. That works today by entering the line in **pieces** — the same rows are stored either way,
since a receipt line keeps base units. **Answered 2026-10-06: the delivery form and the correction
form now accept `6.5` against *carton*** and send the whole number of base units it is
(`toWholeBaseUnits`, `web/src/lib/decimalQuantity.ts`, read as a decimal string, never a float),
refusing when it does not divide whole. `0.5 × 19` has no answer in whole pieces, and that refusal
is the point. The ledger still never sees a fraction.

**A recorded delivery is corrected, never edited** (§5, 2026-10-06): *Deliveries → open one →
Correct this delivery*, `POST /goods-receipts/:id/corrections` (owner/manager), as many times as
needed. Each line takes its **true** received, paid-for and invoice value; the stock difference is a
`receipt_correction` movement on **the line's own lot**, dated the delivery's day; the lot and line
take the true figures (so value, cost of later sales, purchases and both kinds of vendor target read
right — sales already made keep their cost); **the bill moves by the change in value**, never below
what was paid or credited; and a `GoodsReceiptCorrection` keeps what the figures were before, who,
when and why. **`/corrections/preview` runs the real correction and rolls it back**, so the
preview meets every check the save does and the browser computes no money. A line is shown in the
biggest of the product's own units both figures are whole in (`displayUnit`), so 6½ cartons reads
as pieces and 7 reads as cartons again. **A line can be the wrong product, or nothing at all**
(2026-10-07): *Wrong product?* on a line takes the right one (`productId` on the line's true
figures) — the recorded product's whole `quantityReceived` comes back out of the line's own lot
(409 if already sold; the usual override), the right product goes in as **a new lot** at the
line's figures dated the delivery's day, the line names it so purchases and vendor targets follow,
and the bill moves only if the value did. The old lot is left empty, never deleted. A line may go
to **0** when it never came — value 0 too (a vendor who still charged is the bill's amount to
change). `GoodsReceiptCorrectionLine.productIdBefore/After` keep the swap; a count's surplus no
longer borrows the cost of a lot that received nothing.

**When a demo org looks wrong, add the movement that fixes it.** The slice walkthroughs force sales
past the ledger to test the override, which leaves stock negative. Put it right with a **goods
receipt**, not by editing rows — the ledger is append-only and `npm run smoke` checks that
movements still sum to levels.

The root `tsconfig.json` and the jest config are scoped to `src` and `test` so `web/` cannot break
`npm run typecheck` or `npx jest` at the root. Keep it that way.
