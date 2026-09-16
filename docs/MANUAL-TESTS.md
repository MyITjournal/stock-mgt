# Manual test schedule

The by-hand walkthrough of the API in Swagger, in dependency order: every step either needs
something an earlier step created, or checks something an earlier step set up.

**This is not a replacement for `npm run smoke`.** Smoke walks the same ground automatically in
40 steps and asserts the arithmetic — most importantly that the sum of every stock movement
equals the sum of the stock levels. Run it first; it will find broken maths faster than clicking
will. What clicking finds that smoke does not:

- whether the Swagger examples are fillable by a human who has not read the DTO
- what the error messages actually say when you get it wrong
- whether the role gates hold for a *second real user*, not a forged token
- whether a payload reads sensibly to someone building the client against it

Steps marked **[gate]** are the ones where a wrong answer is a bug, not a preference.

## Setup

```bash
npm run start:dev > server.log 2>&1        # terminal 1
```

Swagger is at `http://localhost:4000/docs`; routes are under `/api/v1`. Check port 4000 is free
first — a leftover watch server will map routes and then die on `EADDRINUSE`, leaving old code
answering.

Money is an integer count of kobo throughout. `250000` is ₦2,500.00. `taxRateBps: 750` is 7.5%.

Every `id` field in a request body is **optional** — omit it and Postgres mints one. It exists so
an offline phone can mint the row identity before it has a server. Same for `parentId`: send it
only when you have a real parent id to hand, otherwise you get a 404 from the parent lookup.

---

## A. Rails and auth

**1. `GET /health`** — no auth. Expect `200` and a database-connected flag.

**2. `GET /auth/me` with no token** — expect **401**, not 500. **[gate]**

**3. `POST /auth/register`**

```json
{
  "email": "owner@example.com",
  "password": "correct-horse-battery",
  "firstName": "Adebayo",
  "lastName": "Ogundipe",
  "organizationName": "Adebayo Stores"
}
```

Expect `201`. Then `grep -i otp server.log | tail -1` for the six-digit code — Resend is
unconfigured on a dev machine, so `MailService` logs it instead of sending it.

**4. `POST /auth/verify-otp`** with that email and code. Expect tokens back. Paste the access
token into Swagger's **Authorize** box. `persistAuthorization` is on, so it survives a reload.

**5. `GET /auth/me`** — expect the user *and* the active organization.

**6. `POST /auth/register` again with the same email** — expect **409**, and read the body: it
should distinguish `EMAIL_ALREADY_EXISTS` from `PENDING_VERIFICATION`. **[gate]**

## B. Catalog

**7. `GET /packaging-types`** — expect the 14 seeded defaults, in shelf order: piece, sachet,
pouch, bottle, can, tin, jar, tube, pack, roll, carton, crate, bag, keg. Confirm `sortOrder` runs
10, 20, 30… **[gate]** — they are seeded at registration, so an empty list means registration
did not run its seeds.

**8. `GET /expense-categories`** — expect nine seeded rows. Same reasoning.

**9. `GET /locations`** — expect `Main Store`, seeded and default.

**10. `POST /categories`** — `{ "name": "Beverages" }`. Nothing else. Keep the id off the
response.

**11. `POST /categories`** — `{ "name": "Food Drinks", "parentId": "<id from step 10>" }`.
Then `POST` a third with a `parentId` that does not exist — expect **404 Category not found**,
which is the same 404 you get from filling in Swagger's placeholder. **[gate]**

**12. `POST /price-tiers`** — `{ "name": "Wholesale" }`. Note the id.

**13. `POST /products`**

```json
{
  "sku": "MILO-400G",
  "name": "Milo Refill 400g",
  "categoryId": "<Food Drinks id>",
  "basePrice": 250000,
  "taxRateBps": 750,
  "trackStock": true,
  "reorderPoint": 240,
  "units": [
    { "name": "piece", "factor": 1, "isDefaultSelling": true },
    { "name": "carton", "factor": 24 }
  ]
}
```

**14. `GET /products/{id}`** — expect the derived VAT split. ₦2,500.00 inclusive at 7.5% is
₦2,325.58 net and ₦174.42 tax. **[gate]** — VAT is derived by subtraction and never stored, so
if it comes back as a stored field something has gone wrong.

**15. `PATCH /products/{id}`** — `{ "prices": [{ "unit": "carton", "tierId": "<Wholesale id>",
"price": 5400000 }] }`, cheaper per piece than 24 × base. Keyed by unit **name**, not id. Then
`GET /products/{id}/price?tierId=…&unitId=…` and confirm the tier price beats the scaled base
price. **[gate]**

**15a.** `PATCH` again naming only the *piece* price, then re-check the carton. **The carton price
must survive.** **[gate]** — the arrays upsert what they list; replace-all would mean editing one
unit silently wipes the others.

**15b. `POST /products`** with `prices` and `barcodes` inline in the same call:

```json
{
  "name": "Bournvita Refill 500g",
  "basePrice": 300000,
  "units": [{ "name": "piece", "factor": 1, "isDefaultSelling": true },
            { "name": "carton", "factor": 12 }],
  "prices":   [{ "unit": "carton", "price": 3200000 }],
  "barcodes": [{ "unit": "carton", "code": "5901234123457" }]
}
```

Expect both back on the response. **[gate]** Omit `tierId` as above and it should land on the
default `Retail` tier — which is what a walk-in gets, and the case the old separate endpoint let
people forget. Then send one with `"unit": "crate"` and expect **400** naming the unit.

**16. `POST /products/{id}/barcodes`** — attach a code to the *carton* unit. Then
`GET /scan/{code}` and confirm it resolves to the product, the carton unit, and a price worth 24
pieces. **[gate]** — barcodes attach to units, not products; that is the whole point.

**17. `GET /scan/{code}/identify`** — expect a symbology verdict with no database lookup.

## C. Receiving
**18. `POST /suppliers`** — `{ "name": "Unilever Nigeria" }`. 

**19. `POST /locations`** — `{ "name": "Van" }`, not default.

**20. `POST /goods-receipts`** — two lines, two lots, different expiry dates:

```json
{
  "supplierId": "<supplier id>",
  "locationId": "<Main Store id>",
  "invoiceNumber": "INV-88213",
  "lines": [
    { "productId": "<milo id>", "unitId": "<carton unit id>", "quantityReceived": 10,
      "totalCost": 45000000, "lotCode": "LOT-A", "expiryDate": "2027-03-31T00:00:00.000Z" },
    { "productId": "<milo id>", "unitId": "<carton unit id>", "quantityReceived": 10,
      "totalCost": 48000000, "lotCode": "LOT-B", "expiryDate": "2027-09-30T00:00:00.000Z" }
  ]
}
```

**[gate]** Receiving takes the *invoice total* and the quantity, never a per-unit cost. Unit cost
is a ratio computed on read: 240 pieces from LOT-A at ₦450,000.00 total is ₦1,875.00 each, and
that must not be stored rounded anywhere.

**21. `GET /stock/levels`** — expect 480 base units. Stock is recorded in base units — the unit
with `factor = 1` — so 20 cartons received shows as 480 pieces, not 20. **[gate]**

**22. `POST /goods-receipts` again with the same `Idempotency-Key` header** — expect the *first*
response back and no second receipt. Check `GET /stock/levels` is unchanged. **[gate]**

## D. Moving stock

**23. `POST /stock/adjustments`** — `quantity: -24`, `reason: "damage"`. Do not name a batch.
Expect the write-off to take **LOT-A**, the one that expires first. FEFO is inherited, not chosen.
**[gate]**

**24. `POST /stock/transfers`** — move 48 from Main Store to Van. Then `GET /stock/levels` per
location and confirm the batch identity survived the move: the Van's stock still names the lot it
came from. **[gate]**

**25. `POST /stock/adjustments`** with a quantity larger than what is on hand and no `force` —
expect **409**, and read the message. Then repeat with `force: true` and `forcedReason` — expect
it to succeed and show up in `GET /stock/forced`. **[gate]** The ledger records everything; the
*write path* is what refuses.

**26. `GET /stock/batches`** — expect LOT-A ahead of LOT-B, soonest expiry first.

## E. Selling

**27. `POST /customers`** — one with `priceTierId` set to Wholesale, one without.

**28. `POST /sales`** — the wholesale customer, quantity large enough to span both lots, no
`payment`:

```json
{
  "customerId": "<wholesale customer id>",
  "locationId": "<Main Store id>",
  "lines": [ { "productId": "<milo id>", "unitId": "<piece unit id>", "quantity": 300 } ]
}
```

Expect the tier price, an invoice number, and a cost of goods sold **rounded exactly once** from
the two lots the pick actually took. **[gate]** — check `GET /stock/levels` moved by 300, because
selling calls `StockService.recordOutbound` rather than writing the ledger itself.

**29. `POST /sales`** — the walk-in, with an inline `payment` block:

```json
{
  "locationId": "<Main Store id>",
  "payment": { "amount": 500000, "method": "cash" },
  "lines": [ { "productId": "<milo id>", "unitId": "<piece unit id>", "quantity": 2 } ]
}
```

**[gate]** This must write its own `Payment` row inside the sale transaction — `Sale.amountPaid`
is gone. Confirm with `GET /payments` that the row exists and that its `locationId` is the counter
that rang it up, set automatically.

**30. `POST /sales`** with an explicit `unitPrice` below the tier price — a negotiated price.
Expect it honoured and snapshotted on the line.

**31. `POST /sales/{id}/returns`** — take one line back with `restocked: true`. Confirm stock
comes back and the sale's balance drops.

**32. `GET /sales/{id}/receipt`** — expect a narrow payload: invoice number, lines, total, tax,
paid, balance. **No ids beyond the number, no cost of goods sold, no tier name.** **[gate]** —
this is a contract with a printer, so anything leaking into it is a regression.

## F. Money in

**33. `GET /receivables`** — expect a list sorted oldest-first, not 30/60/90 buckets.

**34. `POST /sales`** — a *second* credit sale for the customer who still owes from step 28.
Expect **409**. There is no credit limit; an unsettled balance gates the next credit sale.
**[gate]**

**35. Same body plus `creditOverrideReason`** — expect it through, with the reason stored on the
sale. Supplying the reason *is* the override, so a sale can never carry one without it. **[gate]**

**36. Same customer, a cash sale** — expect it through untouched. The gate is on credit only.

**37. `POST /payments`** — a part payment with no `allocations`. Expect `allocateOldest` to settle
the oldest invoice first, and the allocation rows to say so.

**38. `POST /payments`** — allocations summing to more than one invoice's balance. Expect **409**.
Then one that overshoots the customer's total — expect the remainder held as credit, not spread.
**[gate]**

**39. `POST /payments`** — a negative amount, i.e. a refund. Expect an ordinary payment row, no
second table.

**40. `POST /payments/{id}/void`** with a reason. Expect the row and its allocations kept, no
longer counting, and the invoice back to owed. Then check `GET /customers/{id}/statement`
reconciles. **[gate]** — correcting a mistake is a void; correcting reality is a negative payment.

**41. `POST /payments/{id}/void` as a `sales_rep`** — expect **403**. Owner, manager and
accountant only.

## G. Expenses

**42. `POST /expenses`** against a seeded category. Then `PATCH` it, then `DELETE` it, and confirm
the deleted one still reaches a syncing client as a tombstone in step 45.

## H. Delta sync

**43. `GET /stock/movements?limit=5`** — page through with the cursor. Append-only, so this sorts
on `createdAt`.

**44. `GET /sales?limit=5`** — same shape.

**45. `GET /payments?since=…`** — checkpoint, then void a payment, then pull again. **The void
must come back.** **[gate]** Payments are mutable, so this feed sorts on `updatedAt`; clients
upsert by id because that ordering can re-send a row. Same for `GET /expenses` with
`includeDeleted`.

**46. `POST /stock/rebuild-balances`** — then `GET /stock/levels` and confirm nothing changed. The
cache is derivable from the ledger, and this proves it.

## I. Stocktake

**47. `POST /stocktakes`** — open a count at Main Store.

**48. `POST /stocktakes/{id}/lines`** — record a count deliberately below live stock for one
product and above it for another.

**49. `GET /stock/levels`** — **must be unchanged.** **[gate]** Counting is not adjusting; this is
the entire reason the two are separate.

**50. `GET /stocktakes/{id}`** — expect the variance per line, computed against live stock.

**51. `POST /stocktakes/{id}/post` as a `sales_rep`** — expect **403**. Recorded by whoever counts,
posted by an owner or manager.

**52. `POST /stocktakes/{id}/post` as the owner** — expect `count_correction` movements. The
shortfall should FEFO out; the surplus should land on the **newest batch at that location**,
because every movement carries a batch. Confirm both appear in `GET /reports/stock-audit`.
**[gate]**

**53. `POST /stocktakes/{id}/post` again** — expect a refusal. **[gate]**

## J. Costing when the paperwork is late

**54.** Force a sale of a product with no stock (`force: true` + `forcedReason`) where a real lot
existed earlier. Expect the line costed from **the last real lot, not zero**, and flagged
`costIsEstimated`. **[gate]** — costing at zero silently loses the real cost from every report
forever, and on a 2–3% margin that is the whole signal.

**55. `GET /reports/profit`** — expect `estimatedCost` to say how much of the period rests on that
guess.

## K. Reports

**56. `GET /reports/dashboard`** — **one call**, everything the home screen needs. **[gate]** —
if the client needs a second request to render the home screen, this has regressed.

**57. `GET /reports/profit`** — **[gate]** revenue is tax-exclusive. Prices are VAT-inclusive, so
this reads *lower* than the sales total by roughly 7.5%. That is it working, not a bug. Check it
against the sales figures by hand once.

**58. `GET /reports/stock-valuation`** — valued from lot totals, rounded once. Never from
`Product.costPrice`. Reconcile against `GET /stock/levels` × the ratio you computed in step 20.
**[gate]**

**59. `GET /reports/collections`** — grouped by location. Every location should add back up to the
total collected, and money that never touched a till should be separated out. This is the
end-of-shift cash-up.

**60. `GET /reports/sales?groupBy=…`** — walk each of day, product, category, customer, location,
rep, tier. Each slice must total to the same number.

**61.** Set the org timezone or the clock near midnight Lagos time and re-run
`GET /reports/dashboard`. **[gate]** Periods resolve in `Organization.timezone`, never UTC —
otherwise "today" rolls over at 1am.

**62.** Record a return in a later month than its sale, then check `GET /reports/profit` for both
months. **[gate]** A return counts in the period it happened, not the month of the sale it
reverses.

**63. `GET /reports/profit`, `/stock-valuation`, `/products` as a `sales_rep`** — expect **403** on
all three. Reps do not see cost. **[gate]**

## L. Tenancy

**64.** Register a second organization with a different email. From its token, `GET /products`,
`GET /sales`, `GET /customers`, `GET /stock/levels` — all must come back **empty**, not
forbidden, not populated. **[gate]**

**65.** From the second org's token, `GET /products/{id}` using an id belonging to the first —
expect **404**, never the row. **[gate]**

**66. `POST /auth/switch-organization`** — expect re-issued tokens scoped to the other org, and
the lists to change accordingly.

---

## Closing check

```bash
npm run smoke
```

Its load-bearing assertion is that the sum of every stock movement equals the sum of the stock
levels. Everything above moves stock; if any of it deducted wrongly, this is what says so — and
nothing else does.
