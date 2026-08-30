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

**Slices 0–5 are done**: rails, tenancy + auth, catalog (products, units, tier pricing, barcodes,
money in kobo), write idempotency, packaging types, the inventory ledger — `StockMovement`
(append-only), locations, suppliers, batches with expiry, receiving, FEFO picking, adjustments
and transfers, delta-sync cursors — sales: invoices with lines, tier pricing, cost of goods
sold, and returns — and money in: payments with allocations, receivables, customer statements,
and expenses.

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

**Next: Slice 6 — reports.** Dashboard, profit, stock valuation, expiry, the vendor purchase
targets that moved out of the cut purchasing slice, and the **PDF invoice and customer
statement**. Every input exists already; the slice is arithmetic over rows that are being written
correctly today, plus a renderer.

On printing generally: thermal receipts (Bluetooth ESC/POS) are the mobile app's job — the server
cannot reach a paired printer — and `GET /sales/:id/receipt` is already the stable payload for
it. PDFs are the server's job. Barcode label sheets are deferred. See §6.

**Before declaring anything done, run `npm run smoke`** — `test/smoke.mjs` walks the whole API
against a running server. Its load-bearing check is that the sum of every stock movement equals
the sum of the stock levels; a sale that deducts wrongly breaks that and nothing else does.

The detail — what is verified against a running server, what is still outstanding, and the full
next-step list — is in [docs/DECISIONS.md](docs/DECISIONS.md) §13 and §14. This section is the
short version; that one is authoritative.

## Working practice

- `main` (release, tagged) → `dev` (integration) → short-lived feature branches merged `--no-ff`.
  Never commit to `main`.
- Plan → get approval → build, one slice at a time.
- A branch is done when `npm run typecheck`, `npm run lint`, `npx jest` and `npm run build` are
  all clean **and** the behaviour is verified against a running server.
- **Finishing a slice means updating the docs in the same branch**: the "Where things stand"
  section above, and `docs/DECISIONS.md` (§13 status, §14 next, the roadmap table, plus any
  decision made or trap hit along the way). The chat gets cleared between slices, so these two
  files are the entire handover — if it is not written down here, the next session does not know it.
- **Never edit a doc with PowerShell `Get-Content -Raw` / `Set-Content`.** PS 5.1 reads UTF-8 as
  ANSI and writes it back mangled — every `—` and `₦` becomes mojibake — and `$` in a regex will
  not match a CRLF line ending, so the replacement silently does nothing while the file is
  corrupted anyway. Use the editing tools.

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
