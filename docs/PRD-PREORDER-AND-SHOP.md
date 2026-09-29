# Product Requirements Document: Preorder and Shop Operations

**Status:** Draft
**Date:** 2026-09-17
**Product area:** WhatsApp-first preorder management, shop sales, and inventory integration

> **Assessment:** see [MARKET.md §6](MARKET.md) — where this fits, the competitive gap it aims at,
> and two findings that change the build. In short: **one backend, two product surfaces**, which
> removes most of §9's integration contract; and **a variant is not a unit**, which is the one
> genuinely new piece of catalog modelling required.

## 1. Summary

This product helps vendors who advertise goods through WhatsApp, collect customer preorders before the goods arrive, and sell remaining goods through a physical shop and online channels.

The product must keep two facts separate:

- A preorder is paid or committed customer demand for goods that have not arrived.
- Inventory is physical stock that has been received and can be allocated or sold.

The product may be presented as a standalone preorder app, but it must connect to an existing shop and inventory backend when one is available. The existing backend remains the source of truth for physical stock in connected mode.

## 2. Problem

The current workflow is managed through WhatsApp posts and private messages. This makes order tracking difficult because of the difficulty of tracing from a large bulk of unread messages. This makes it difficult to answer:

- Who ordered a particular variant, such as shoe size 39?
- Who has paid, partially paid, or not paid?
- How many units are expected for each variant?
- What actually arrived compared with what customers ordered?
- Which customers can be notified for pickup?
- Which remaining units can be sold in the shop?
- Which orders are still outstanding, cancelled, refunded, or uncollected?

The product should reduce manual reconciliation without forcing the vendor to abandon WhatsApp as the main customer communication channel.

## 3. Goals

### MVP goals

1. Let a vendor publish a product drop with images, variants, prices, and instructions.
2. Let customers submit interest or a preorder through a shareable link.
3. Record customer preferences, payment commitments, and payment status.
4. Record actual goods received after a preorder is placed.
5. Allocate received units to eligible preorders.
6. Notify customers when their goods are ready for pickup.
7. Move only surplus physically received units into shop inventory.
8. Let the vendor track pickup, cancellation, refund, and shortage outcomes.
9. Support normal walk-in and online shop sales without mixing them with preorder demand.

### Non-goals for the MVP

- Full accounting or double-entry bookkeeping
- Automatic prediction of supplier deliveries
- Supplier purchase-order management
- Marketplace discovery for customers
- Delivery fleet management
- Barcode label printing
- Automatic payment confirmation for every bank transfer
- Replacing WhatsApp as the vendor's communication channel

## 4. Users

### Vendor or owner

Creates drops, confirms payments, records receipts, resolves shortages, and monitors
uncollected orders.

### Staff member

Records customer payments, prepares pickup orders, and marks orders collected according
to assigned permissions.

### Customer

Views a shared drop, selects product preferences, submits contact information, pays or
indicates interest, receives readiness updates, and collects the order.

### Shop operator

Processes walk-in or ordinary online sales from stock that is actually available.

## 5. Terminology

| Term           | Meaning                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| Drop           | A time-bounded product offering shared with customers, usually through WhatsApp |
| Variant        | A sellable preference such as size, colour, style, or unit                      |
| Interest       | A non-binding expression of demand before payment                               |
| Preorder       | A customer commitment for a product that has not arrived                        |
| Receipt        | The vendor's record of goods physically received                                |
| Allocation     | Matching received units to specific preorder customers                          |
| Surplus        | Received units left after eligible preorders are allocated                      |
| Shop inventory | Physical stock available for walk-in or ordinary online sale                    |
| Pickup         | The handover of an allocated order to its customer                              |

## 6. Core workflow

```text
Vendor publishes drop
  -> Customer selects variant and quantity
  -> Customer indicates interest or places preorder
  -> Vendor records or confirms payment
  -> Preorder remains outside physical inventory
  -> Goods arrive
  -> Vendor records actual quantities received by variant
  -> System allocates received goods to eligible preorders
  -> Customers are notified that goods are ready
  -> Customer picks up, or order is cancelled/refunded
  -> Surplus received goods enter shop inventory
```

### 6.1 Interest and preorder

The vendor may allow two entry points:

- **Interest:** customer details and preferences are captured, but no stock or payment
  commitment exists.
- **Preorder:** the vendor accepts the request and payment or deposit is recorded.

Only accepted preorders participate in allocation. The vendor must be able to convert
interest into a preorder or decline it.

### 6.2 Payment

Payment status must be explicit and must not be inferred from a chat message:

- Pending
- Part-paid
- Paid
- Refunded
- Payment disputed

Manual payment recording is required for the MVP. Payment links and gateway webhooks
may be added as integrations.

### 6.3 Receiving and allocation

The vendor records actual receipt quantities by variant. The system must never add a
preorder quantity to on-hand inventory before this action.

For each variant:

1. Determine eligible accepted preorders.
2. Allocate received units to those preorders according to the vendor's configured
   allocation policy, defaulting to oldest accepted preorder first.
3. Mark allocated orders ready for pickup.
4. Mark unfulfilled quantities as short delivery or awaiting resolution.
5. Put any remaining received units into shop inventory.

Example: 10 units are preordered, 12 arrive, and all 10 preorders are eligible. Ten
units are allocated to customers and two enter shop inventory. If only eight arrive,
eight are allocated and two orders are flagged for resolution; the system must not
pretend that ten were received.

### 6.4 Pickup

The vendor must be able to search for a customer or order, verify the items and balance,
and mark the order picked up. The system should support a pickup code or QR code but
must also work with a manual lookup.

An order with an outstanding balance may be blocked from pickup unless an authorized
staff member overrides the block and records a reason.

## 7. Order lifecycle

```text
INTERESTED
  -> PAYMENT_PENDING
  -> PAID or PART_PAID
  -> AWAITING_ARRIVAL
  -> READY_FOR_PICKUP
  -> PICKED_UP
```

Alternative states:

- `CANCELLED` before fulfillment
- `REFUNDED` after payment reversal
- `SHORT_DELIVERY` when received quantity cannot satisfy the order
- `UNCLAIMED` when ready goods are not collected by the configured deadline

The UI must distinguish customer payment state from fulfillment state. For example,
`PAID + AWAITING_ARRIVAL` is valid and must not be shown as available shop stock.

## 8. Functional requirements

### Product drops

- Vendor can create, edit, publish, pause, close, and archive a drop.
- A drop supports one or more product variants.
- A variant supports attributes such as size, colour, style, and quantity requested.
- Vendor can attach images, a description, price, deposit requirement, deadline, and
  expected arrival information.
- Vendor can share a public customer link suitable for WhatsApp.
- Vendor can see demand totals grouped by variant.

### Customer capture

- Customer can submit name, phone number, selected variant, quantity, and notes.
- Customer can choose interest or preorder where the vendor enables both options.
- Duplicate submissions should be detected and presented for review rather than silently
  creating accidental duplicate orders.
- Customer receives a reference number after submission.

### Payment tracking

- Vendor can record amount, date, method, reference, and account for a payment.
- A preorder shows total due, total paid, and balance due.
- Multiple payments are supported.
- Refunds and reversals remain auditable.
- Payment records are tenant-scoped and follow the existing money rules: integer minor
  units, no floating-point amounts.

### Receipt and allocation

- Vendor can record actual receipt quantities by variant.
- Receipt quantities are not available to shop sales until allocation is complete.
- Allocation results show fulfilled, short, and surplus quantities.
- The system creates physical inventory only from goods recorded as received.
- Surplus is available to shop sales only after preorder allocation.
- Every allocation and adjustment is auditable.

### Notifications

- Vendor can send a ready-for-pickup message to selected customers.
- Vendor can send shortage, cancellation, and refund updates.
- MVP may generate WhatsApp-ready message text for manual sending.
- Automated WhatsApp or SMS delivery should be an adapter, not a requirement for the
  core workflow.

### Shop sales

- Walk-in and ordinary online sales use the same physical inventory source.
- A shop sale must not consume units allocated to an uncollected preorder.
- Sales identify their channel, at minimum `PREORDER`, `WALK_IN`, and `ONLINE`.
- Vendor can view preorder demand separately from available shop stock.

## 9. Inventory and integration rules

### Connected mode

When connected to the existing backend:

- Catalog and variant identity are shared or mapped explicitly.
- The existing inventory ledger is authoritative for physical stock.
- Preorder records remain in the preorder module until goods are received.
- A receipt/allocation operation passes only physically received quantities to inventory.
- The integration must be idempotent so a retry cannot duplicate a receipt, payment, or
  allocation.
- Shop inventory must expose reserved-for-preorder and available-for-sale quantities
  separately.

### Standalone mode

Without a shop integration, the app can manage drops, customers, preorders, payments,
receipts, allocations, and pickup. Its local inventory begins only when the vendor
records goods as received.

The product must not silently merge standalone and connected inventory. A tenant must
have one declared inventory authority for each location.

### Integration contract

The first integration should provide:

- Product and variant import or mapping
- Customer upsert
- Payment creation and lookup
- Goods receipt creation
- Allocation confirmation
- Available-stock lookup
- Pickup and sale status events

Integration failures must be visible to the vendor and retryable. A failed connection
must not create a local state that appears successful.

## 10. Permissions

- Owner or manager: configure drops, approve receipts, resolve shortages, refund, and
  override pickup balance rules.
- Staff: capture payments, prepare orders, and mark pickup according to assigned access.
- Sales representative: view assigned orders and record permitted customer actions.
- Customer: access only their own order through a secure reference or link.

All tenant-owned records must be isolated by organization. Sensitive customer and payment
data must not be exposed through public drop links.

## 11. MVP screens

1. Drops list and drop editor
2. Public customer order form
3. Variant demand view
4. Preorder list with payment and fulfillment filters
5. Payment recording screen
6. Goods receipt and allocation screen
7. Ready-for-pickup queue
8. Pickup confirmation screen
9. Shop availability view showing reserved versus available quantities
10. Basic reports: outstanding payments, shortages, ready orders, uncollected orders,
    and preorder versus surplus quantities

## 12. Success metrics

The pilot should measure:

- Reduction in time spent reconciling WhatsApp orders
- Percentage of orders with complete variant and customer information
- Payment status accuracy
- Number of duplicate or missed orders
- Time from receipt to customer notification
- Pickup completion rate
- Number of shop sales blocked by incorrect reservation handling
- Percentage of pilot vendors who continue using the product after the trial
- Monthly willingness to pay

## 13. Subscription direction

The product should support subscription billing per organization, not per individual
customer order in the first release.

Possible tiers:

- **Starter:** limited active drops, manual payments, basic pickup tracking
- **Business:** unlimited drops, automated notifications, payment links, reports
- **Team:** staff accounts, multiple locations, integrations, audit history

Do not make payment processing the only monetization path. The primary value is reduced
operational work and fewer lost or incorrectly fulfilled orders.

## 14. Release plan

### Phase 1: Pilot MVP

- Drops and public order links
- Product variants
- Customer and preorder records
- Manual payments and balances
- Manual receiving and allocation
- Pickup tracking
- WhatsApp-ready notifications
- Standalone operation

### Phase 2: Shop integration

- Catalog and customer mapping
- Goods receipt integration
- Reserved versus available stock
- Shop and online sales channels
- Idempotent synchronization and retry handling

### Phase 3: Operational automation

- Payment gateway links and webhooks
- WhatsApp Business messaging integration
- Pickup QR codes
- Staff workflows and multiple locations
- Subscription billing and plan enforcement

## 15. Acceptance criteria

The MVP is acceptable when:

1. A vendor can publish a shoe drop with size and colour variants.
2. A customer can submit a preorder and receive a reference number.
3. The vendor can record a deposit and see the remaining balance.
4. The preorder quantity does not appear as on-hand or shop-available inventory before
   receipt.
5. The vendor can record actual quantities received by size and colour.
6. The system allocates received units to eligible preorders and flags shortages.
7. Surplus received units become shop-available only after allocation.
8. The vendor can notify and mark a customer order picked up.
9. A shop sale cannot consume stock reserved for an uncollected preorder.
10. Duplicate receipt or payment requests do not duplicate financial or stock records.
11. Connected and standalone modes clearly identify their inventory authority.
12. A vendor can produce lists of unpaid, ready, short, refunded, and uncollected orders.

## 16. Open decisions

- Whether unpaid customer interest expires automatically
- Whether allocation is strictly oldest-first or manually selectable
- Whether the vendor must collect a deposit before accepting a preorder
- Pickup deadline and unclaimed-stock policy
- Whether a shortage results in automatic refund or vendor decision
- First payment provider and WhatsApp messaging provider
- Whether a standalone tenant can later migrate into a connected shop tenant
- Whether preorders may be accepted against an expected supplier quantity limit

## 17. Product principles

1. **Demand is not inventory.** A preorder does not change physical stock.
2. **Receive before allocating.** Customer allocation is based on what actually arrived.
3. **Preorders are fulfilled before surplus is sold.**
4. **Payment and fulfillment are separate states.** Paid does not mean picked up.
5. **One inventory authority per location.** Integrations must not create competing stock
   ledgers.
6. **Every important correction is auditable.** Do not overwrite payment, receipt, or
   allocation history.
