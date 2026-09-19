# Product Requirements: v2

**Status:** Draft for approval
**Date:** 2026-09-19
**Supersedes nothing.** It sequences work specified elsewhere and adds two areas that were not.

> **Read alongside:**
> [`PRD-PREORDER-AND-SHOP.md`](PRD-PREORDER-AND-SHOP.md) — the preorder product, specified in full.
> [`MARKET.md`](MARKET.md) §6 — where preorder fits, and why it runs on this backend.
> [`DECISIONS.md`](DECISIONS.md) §15 — the open-items list this draws from.
>
> This document does **not** restate the preorder PRD. It says when preorder happens, what it
> needs from the catalog first, and what else belongs in v2.

---

## 1. What v1 is, and why that changed

**v1 is the backend plus a web dashboard, then deployed.** Decided 2026-09-19.

The roadmap had put the dashboard at slice 7, _after_ deployment. That ordering ships a URL rather
than a product: an API with no interface has no users, no feedback, and nothing to sell. Since
`MARKET.md` §6 ends "then stop and sell", v1 has to be something a shop owner can open.

### What is left to close v1

| #   | Item                                   | Source          | Notes                                                                                                                        |
| --- | -------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Web dashboard**                      | roadmap slice 7 | The bulk of remaining v1 work                                                                                                |
| 2   | **Deploy to Render**                   | §15 item 1      | Plan written, `render.yaml` not built                                                                                        |
| 3   | Mail configured in production          | §9              | `RESEND_API_KEY` and `MAIL_FROM` are now **required** to boot in production — a sender domain must be verified before deploy |
| 4   | A "not sellable" flag on `ProductUnit` | §15 item 7      | Cheap; only matters once real reps use it                                                                                    |
| 5   | Idempotency on `void` and `cancel`     | §15 item 12     | Deliberate non-goal until a client needs it                                                                                  |

Everything else in §15 is either closed, deferred by design (rate-limit storage, receivables performance), or belongs to v2 and is covered below.

### What v1 deliberately does not include

Nothing in this document. v1 closes on the list above; **v2 starts after a real user has touched v1**, for the reason in §6.

---

## 2. Variants: the model, decided

The one genuinely new piece of catalog modelling the preorder product needs (`MARKET.md` §6), and the one §15 item 13 said to decide **before anything points at it**.

### The rule

**A variant is an optional sub-identity of a product. Units and variants are different axes, and in practice they rarely both matter.**

- A **unit** is a packaging multiple of the _same item_: a carton of Milo holds 12 × 400g refills. Stock is recorded in the factor-1 base unit and the whole ledger rests on that (§4).
- A **variant** is a _different sellable item sharing a product identity_: size 41 in black. Neither is a multiple of the other.

FMCG products have units and no variants. Shoes, phones and clothing have variants and usually one trivial unit. Both existing at once is possible — a T-shirt in size M sold in packs of twelve — but it is the uncommon case, not the design centre.

### The shape

A new `ProductVariant` table, and a **nullable `variantId`** on every table that carries stock or money for a product:

```
ProductVariant
  id, organizationId, productId
  name          "Size 41 / Black"
  attributes    size, colour, style — the axes that make it distinct
  sku, isActive, sortOrder
```

| Table                                           | Why it needs `variantId`                   |
| ----------------------------------------------- | ------------------------------------------ |
| `StockMovement`, `StockBalance`, `StockBatch`   | Size 39 and size 41 are different stock    |
| `SaleLine`, `GoodsReceiptLine`, `StocktakeLine` | You sell, receive and count a specific one |
| `ProductPrice`                                  | Size 45 may cost more than size 39         |
| `ProductBarcode`                                | Each variant scans differently             |

**Null means the product has no variants**, which is every FMCG product. Nothing changes for them, and the column never appears on their screens.

### Why not "a variant is its own Product"

Rejected by the owner, 2026-09-19, and the reasoning holds: it makes "Nike Air Max" a grouping rather than a thing, copies description, category and tax rate across every size, and turns "how many Air Max do I have" into a sum over rows that only convention says belong together.

### Why nullable columns rather than a new ledger grain

It is **additive**. Existing rows stay valid with no backfill, every current query keeps working, and an organization that never creates a variant never notices. That is also what makes it safe to _build_ this in v2 rather than now: the decision is what had to be made early, not the migration.

### ⚠ The trap this will hit, which has been hit before

`StockBalance` is unique per (organization, product, location, batch). Adding `variantId` to that key looks right and **does not work**: Postgres treats NULLs as distinct, so two identical variant-less balance rows would not collide, and stock would silently split across duplicates.

This is precisely the `PurchaseTarget` bug in §13 — _"a unique constraint over a nullable column"_. The fix is the same and must be planned from the start: **two partial unique indexes**, one `WHERE "variantId" IS NULL` and one `WHERE "variantId" IS NOT NULL`, hand-written in the migration because Prisma cannot express a partial index. Check `migrate diff` returns empty afterwards, as was done for `PurchaseTarget`.

---

## 3. Orders taken over WhatsApp

**This is not the preorder product, and conflating them would be the same error as conflating a variant with a unit.**

|              | Pre-order                    | WhatsApp order to the shop          |
| ------------ | ---------------------------- | ----------------------------------- |
| The goods    | Do not exist yet             | Already on the shelf                |
| The ledger   | Must not know about it       | Stock is real and must be committed |
| Resolved by  | Allocation when goods arrive | Picking and handing over            |
| Specified in | `PRD-PREORDER-AND-SHOP.md`   | Here — nothing covers it            |

A customer messaging "send me 2 cartons of milk" is placing a **sale that has not happened yet** against stock that exists. Between the message and the handover, those cartons must not be sold to somebody standing at the counter.

### Reservations

The system has no way to express that today, and it cannot be expressed by writing a movement: **stock is an append-only ledger and a reservation is not a thing that physically happened.**

So a reservation is its own record — a claim on a future movement, never a movement:

```
StockReservation
  productId, variantId?, locationId, quantity   what is held
  orderId                                        why
  expiresAt                                      when the hold lapses
  status         held | consumed | released | expired
```

Four rules:

1. **Available to sell = balance − live reservations.** A derived figure computed on read, like every balance in this system. `StockBalance` is not touched.
2. **Reservations expire.** Without a deadline, an abandoned chat order locks stock forever, and the shop stops trusting the number — which is worse than not having reservations at all. The window is a per-organization setting.
3. **Fulfilment goes through the ordinary sale path.** Confirming the handover writes a normal `Sale`, which calls `StockService.recordOutbound` and therefore inherits FEFO, the insufficient-stock 409 and the owner override, exactly as §6 requires of selling. The reservation is consumed, not converted.
4. **A reservation is never revenue.** It is not a sale, it does not appear in profit, and it does not count toward a vendor target or a collections figure.

### Order capture

```
SalesOrder
  channel    walk_in | whatsapp | phone | online
  status     pending | confirmed | fulfilled | cancelled | expired
  customerId?, lines, note
```

Confirming an order reserves stock. Fulfilling it writes the sale. Cancelling or expiring releases the reservation.

**The MVP does not integrate with WhatsApp.** Somebody reads the message and types the order in. Meta's WhatsApp Business Platform needs business verification, template approval and per-conversation pricing, and none of that is worth carrying before there is a shop using the feature. This is the same stance the preorder PRD takes on notifications: _"automated WhatsApp or SMS delivery should be an adapter, not a requirement for the core workflow."_

What the MVP should do is generate the **reply text** — "2 cartons Peak Milk, ₦10,800, ready for pickup" — for the shop to paste back.

---

## 4. Bank statement import

The owner's request: transactions from the bank appear in the system and are linked to the customer or vendor they belong to.

### The API is not the hard part; matching is

A Nigerian transfer narration rarely names an invoice. It says `TRF FROM ADEBAYO S` and an amount. Deciding that this is Adebayo Stores settling INV-0042 is a **judgement**, and the system can be right most of the time and confidently wrong the rest.

So the rule is:

> **The importer proposes. A person confirms. Nothing writes a payment on its own.**

Writing payments straight from a feed would put money in the books that nobody verified and break §11's "one row per thing that actually happened". The preorder PRD already lists _"automatic payment confirmation for every bank transfer"_ as a non-goal, and that judgement carries here.

### Shape

```
BankTransaction          one row per line on the statement
  bankAccountId, occurredAt, amount (signed), narration, reference
  importBatchId, status: unmatched | suggested | confirmed | ignored
  matchedPaymentId? / matchedSupplierPaymentId?
```

1. **Import.** A statement file is uploaded — CSV or OFX first, the bank's PDF later. Each row becomes a `BankTransaction`, keyed so the same statement imported twice cannot duplicate anything (the `Idempotency-Key` discipline, applied to rows).
2. **Suggest.** For each unmatched transaction, score candidates: exact amount against an open invoice or vendor bill, proximity of date, the customer or vendor name appearing in the narration, and the account it landed in. Credits match receivables; debits match payables.
3. **Confirm.** One click writes a real `Payment` or `SupplierPayment` with the narration's reference copied onto it, through the existing services — so allocation rules, the void discipline and the bank-account rule are all inherited rather than reimplemented.
4. **Leave the rest.** Unmatched transactions stay in an inbox. A statement line nobody can explain is information, not an error.

### Why file import before an open-banking API

Mono, Okra and Stitch all offer live feeds, and a live feed is a better experience. It also adds a consent flow, a per-account recurring cost and a vendor dependency — before there is revenue.

**The matching engine is the same either way.** Building it against uploaded statements means the expensive, interesting part is done and proven, and swapping in a live feed later is an adapter behind the same `BankTransaction` table. This also folds in the **bank statement parser** already sitting in the project pipeline, rather than building it as a separate product.

`BankAccount.bankCode` was added for exactly this and already carries the comment saying so.

---

## 5. Pre-order and drops

**No new specification.** `PRD-PREORDER-AND-SHOP.md` covers it, and `MARKET.md` §6 assessed it: roughly 70% already exists here, and running it on this backend deletes most of the PRD's §9 integration contract — "connected mode" becomes a flag on the organization rather than a synchronisation protocol.

What this document adds:

- **It depends on variants** (§2 above). That is the ordering constraint.
- **It is a module enabled per organization**, with two product surfaces. An FMCG distributor never sees drops; a shoe vendor never sees FEFO or vendor purchase targets.
- **Allocation is structurally payment allocation.** Twelve arriving units answering ten preorders is the same shape as one payment answering three invoices. Reuse the thinking in `payments/allocation.ts`; do not invent a second idiom.
- **Its "surplus enters shop inventory" step is the reservation model in §3** wearing a different hat. Build reservations once.

---

## 6. Sequencing, and the constraint that governs it

`MARKET.md` §6 named the risk before this document existed:

> Four things are in flight — stock-mgt at ~90%, this PRD, the statement parser, the loan app.
> Every one is a decent idea. Building all four before any has a paying customer is the ordinary
> way good ideas die, and one developer's time is the binding constraint.

Bank integration makes five. So the sequence is deliberately serial, and each step has a gate:

| Step                             | Gate to start                                                         |
| -------------------------------- | --------------------------------------------------------------------- |
| **Close v1** — dashboard, deploy | now                                                                   |
| **Get one real user on it**      | v1 deployed                                                           |
| **Variants**                     | a user exists, and preorder is the next thing they or a prospect want |
| **Reservations + order capture** | a shop is losing orders in WhatsApp messages                          |
| **Pre-order and drops**          | variants done, and a vendor asking for it                             |
| **Bank statement import**        | somebody is reconciling by hand and complaining about it              |

**The gates are the point.** Every item here is worth building and none of them is worth building before somebody wants it. If a gate cannot be met, that is information about the feature, not an obstacle to route around.

---

## 7. Explicitly out of scope for v2

- **Open-banking live feeds.** See §4.
- **WhatsApp Business API automation.** See §3.
- **Accounting or double-entry.** Unchanged since day one.
- **Purchase orders.** Still cut; §6 of `DECISIONS.md` and §16 both hold.
- **Delivery and logistics.**
- **Marketplace or customer discovery.**
- **The loan app.** A different product with a different buyer.

---

## 8. Open decisions

These need answers before the slice that depends on them, not before this document is approved.

1. **Reservation expiry default.** Hours or days, and whether a shop can override per order.
2. **Whether an expired reservation notifies anyone**, or just quietly releases.
3. **Variant attributes: structured columns or free-form.** `size`/`colour`/`style` is rigid but sortable and filterable; a JSON bag is flexible and harder to report on. Leaning structured, with the axes configurable per organization.
4. **Statement formats to support first.** Depends on which banks the first users actually use.
5. **Whether order capture needs its own public link** (as drops do) or stays staff-entered only.
