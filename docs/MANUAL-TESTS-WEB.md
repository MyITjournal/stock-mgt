# Manual test schedule — the web dashboard

The by-hand walkthrough of `web/`, in dependency order: every section either needs something an
earlier section created, or checks something an earlier section set up.

**This exists because nothing else can do it.** There is no browser driver in this project, so
across every slice the wiring, the arithmetic and the refusals were checked and **the rendering
never was**. Two of the eleven bugs in §18 of `DECISIONS.md` — a money field that ate every
keystroke after the first, and form boxes that collapsed to zero width — made whole screens
unusable while `typecheck`, `lint`, `jest` and `smoke` all stayed green. This walkthrough is the
only gate that catches that class.

`docs/MANUAL-TESTS.md` is the companion for the API in Swagger. Run `npm run smoke` before either
of them; it will find broken arithmetic faster than clicking will.

Steps marked **[gate]** are the ones where a wrong answer is a bug, not a preference.

---

## Setup

Two servers, two ports.

```bash
: > server.log                              # stale OTPs otherwise match
npm run start:dev > server.log 2>&1         # terminal 1 — API on 4000
cd web && npm run dev                       # terminal 2 — dashboard on 5173
```

**Open `http://localhost:5173`.** `npm run start:prod` is not this — it serves the API alone.
Check port 4000 is free first; a leftover watch server maps its routes and then dies on
`EADDRINUSE`, leaving old code answering.

**Sign in as the owner**: `smoke+179011136395356@example.com` / `correct-horse-battery`
(Adebayo Stores, `adebayo-stores-f84554`). A staff login in the same org is
`bola@adebayo-stores-f84554` / `password123` — used in section K. Prefer **bola**: its membership
is open all day, so a run after 7pm still signs in.

Several orgs share names, because every smoke run mints a fresh one. **If a screen reads empty,
check which tenant you are signed into before debugging it.**

Money is displayed as `NGN 2,500.00`. Cost figures are **absent, not zero**, for a rep — an em
dash is correct there, a `₦0.00` is a bug.

---

## A. The frame, and the first screen

**1. Sign in as the owner.** Expect the home screen: four figures across the top (sold today,
collected today, sold this month, uncollected), then owed-to-me, gross profit, operating profit,
what I owe.

**2. [gate] Every figure reads as money or a dash — never `NaN`, never `undefined`, never
`₦NaN`.** The margin notes under gross profit are percentages derived from a cost field; a
`NaN%` there is the §18 bug class returning.

**3. [gate] Resize the window to phone width.** Nothing overflows sideways, no box collapses to
nothing, every field is still clickable.

**4. Click each nav item in turn** — Home, Till, Sales, Customers, Money, Stock, Reports,
Settings. **[gate] Every one renders something real.** A spinner that never resolves, a red error
box, or an empty table where you know there is data is a bug.

**5. Open a detail screen, then use its back link.** Sales → click a sale → **Back to sales**.
**[gate] The filters you had set are still there.** The back link steps through history rather
than re-navigating, which is what preserves them.

**6. Paste a detail URL into a fresh tab** — `http://localhost:5173/sales/<id>`. **[gate] The back
link still works**, falling back to the named route when there is no history behind it.

**7. Type a route that does not exist** — `/nonsense`. Expect a redirect, not a blank page.

---

## B. The till

The screen that has to be fast and cannot be wrong. Everything here is at `/till`.

**8. Search for a product by name**, add it to the cart. The line shows the product, a unit picker, a quantity and a price.

**9. [gate] Type a quantity of `12` into the quantity box, digit by digit.** All of it arrives.
A box that shows `1` and swallows the `2` is the §18 input bug. Then **backspace the box empty** — it clears. A field that snaps the old number back cannot be corrected.

**10. [gate] Change the unit on a line from piece to carton.** The price changes to the carton price, and it is **not** the piece price times the factor. That multiplication is the overcharge the tier-pricing model exists to prevent.

**11. [gate] Pick a customer on a tier, and watch the line re-price.** The browser must never work out a price itself — every change re-asks the server.

**12. Override a price on a line.** The line shows it was overridden against the list price.

**13. Take a payment.** Cash, then a transfer. **[gate] Transfer demands a bank account and cash refuses one.** Neither is defaulted for you — a wrong account only surfaces at reconciliation.

**14. [gate] Complete the sale and read the receipt.** The totals on the receipt match what was on the screen to the kobo. VAT prints as *"of which"*, never added on top.

**15. [gate] Double-click the complete button.** One sale, not two. This is what the idempotency key is for and a till is where double-clicks happen.

**16. Sell more of something than you have.** Expect a **refusal**, not an error — a clear message saying there is not enough stock. As the owner you are offered an override that needs a reason.

**17. [gate] Override it, and let the first attempt fail if it wants to.** The override must go through. The sale keeps its id across attempts while each attempt carries a fresh key; getting that backwards makes every override fail with a 409.

**18. Sell on credit to a customer who already owes.** Expect the same shape of refusal, with the reason box as the override.

---

## C. Sales, returns and customers

**19. `/sales`** — the list is newest first. **[gate] The sale you just rang up is on it**, without a refresh and without a wait. A just-recorded row that takes a second to appear is the sync-lag bug.

**20. Filter by date, then clear the filter.** The list responds both ways.

**21. Open the sale. [gate] The lines and totals match the receipt.**

**22. Record a return of one line, restocked.** The sale shows the return; the invoice is owed less.

**23. [gate] Record a damaged return — `restocked: false`.** Money comes back and **no stock moves**. Crushed goods never become sellable again, so the screen must ask rather than assume.

**24. `/customers`** — open one with a balance. **[gate] The balance matches what `/money` says it is.** Two screens showing one number must have one implementation behind them.

**25. Download the statement PDF, and the invoice PDF from a sale.** **[gate] Both open as PDFs.**
A JSON error page instead means the download bypassed the refresh — a raw link rather than `api.document`.

**26. [gate] Leave the tab for fifteen minutes, then download a PDF.** The access token has expired by then, and it must still work.

---

## D. Money in

**27. `/money`** — receivables, oldest first. **[gate] The headline total equals the sum of the groups below it.** These disagreed once, by a returned invoice, because the headline and the breakdown each decided what counts.

**28. Record a payment against one invoice, choosing the invoice explicitly.** The invoice is settled; the list updates without a refresh.

**29. Record a payment larger than one invoice, oldest-first.** **[gate] It settles the next invoice too**, and anything left over stays as credit on the customer — not as an error.

**30. [gate] Try to allocate more to a single invoice than it is owed.** Expect a refusal.

**31. Void a payment.** **[gate] The dialog says what a void *means*** — that the money never moved — and offers the refund as the alternative. The two are not interchangeable and a screen that makes them look it is the bug.

**32. [gate] The voided payment stays on `/money/payments`** (the audit trail) **and disappears from the customer's statement** (their position). Both, or it is wrong.

**33. Record a negative payment — a refund.** It appears as money out, not as a second kind of row.

**34. `/money/accounts`** — add an account, deactivate one. **[gate] An account with payments against it cannot be deleted.**

---

## E. Money out

**35. `/money/payables`** — bills with money on them, longest-owed first, grouped by vendor.

**36. Pay a supplier bill in full.** **[gate] One payment settles exactly one bill** — there is no allocation here, and that absence is deliberate.

**37. [gate] Try to overpay a bill.** Expect a **refusal**, not credit. This is where the vendor side deliberately differs from the customer side.

**38. [gate] There is no negative supplier payment.** Void is the only correction offered.

**39. `/money/expenses`** — record one. **[gate] The screen says on it that a supplier payment is not an expense.** Recording stock twice understates every margin, and that is the trap worth a line of text.

---

## F. The catalog

**40. `/stock`** — the product list. Open one.

**41. Create a product** with two units (`piece` factor 1, `carton` factor 12), a price on each, and a barcode.

**42. [gate] Type `1999.99` into a price box, digit by digit.** It reads `1999.99` — not `₦9.01`. This is the §18 money-field bug, and it *saved* the wrong number, so check what comes back after you save.

**43. [gate] The unit name box and the factor box sit side by side and both are usable.** A factor box that fills the row and squashes the name box to nothing is the `className` bug.

**44. [gate] The factor box takes `24` digit by digit, and can be backspaced empty.**

**45. [gate] There is no delete button on a unit or a price.** Units and prices upsert and never delete; a remove button would silently do nothing. Barcodes *can* be deleted.

**46. [gate] The base unit cannot be changed.** Stock is counted in it.

**47. [gate] Cost is shown, never typed.** The product screen says where the cost came from and tells you to record a delivery. An editable cost box takes a number and forgets it.

**48. Add an in-house barcode starting with `2`.** **[gate] A wrong check digit is refused.** A scanner never produces a mistyped string, so a code that is accepted and never scans is worse than a refusal.

**49. Create a service** — `trackStock` off, base unit `trip` factor 1. Sell it at the till.
**[gate] It sells without touching stock**, and shows a 100% gross margin, which is correct.

---

## G. Stock

**50. `/stock/levels`** — on hand, with lots behind each row.

**51. Adjust a row down.** It is a dialog on the row, not a screen — you adjust *this product at this location*, which the click already said.

**52. [gate] Adjust below zero.** Refusal, with the reason box as the override for an owner.

**53. Transfer between two locations.** **[gate] The two rows move by the same amount.**

**54. Bring stock on as a surplus.** **[gate] It asks for a lot code, an expiry and what it is worth.** An unvalued surplus reads as free goods to everything that sums it.

**55. `/stock/receive`** — record a delivery: invoice total, quantity received, quantity paid for.
**[gate] The screen says out loud that this raises a bill on *We owe*.** The goods value on a receipt is not what is owed.

**56. [gate] Enter a delivery where `quantityPaidFor` is less than `quantityReceived`** — buy 19,
get 1 free. Both numbers are kept, and the gap is free goods.

**57. `/stock/movements`** — newest first, and the row your adjustment wrote is on it.

**58. `/stock/counts`** — start a count, record quantities. **[gate] Counted quantities are base
units with no unit picker**, and **`0` is accepted** — counting nothing is a real count.

**59. [gate] The count sheet tells the counter that somebody else posts it.** Counting is not adjusting; nothing moves until an owner or manager posts.

**60. Post the count as the owner.** Variance is recomputed against live stock now, not when it was counted, and the corrections appear on the movement ledger.

---

## H. Reports

**61. `/reports`** — profit. **[gate] Revenue reads lower than you expect.** It is tax-exclusive;
counting the gross would overstate every margin by 7.5%.

**62. Change the period, then switch to another report.** **[gate] The period survives** — it is
in the URL, so a link to one report over one month is sendable.

**63. [gate] Copy the URL into a new tab.** Same report, same period.

**64. `/reports/collections`** — **[gate] collected and sold are shown side by side, and the
difference between them is not shown.** Collections include payments on invoices from months ago,
so that subtraction would be wrong.

**65. `/reports/sales`, `/reports/purchases`, `/reports/stock`, `/reports/movers`** — each renders,
and every margin column is a percentage or a dash.

**66. `/reports/targets`** — **[gate] a product with its own target is not also counted under its
category's target.** One carton advancing two rows is the rollup bug.

---

## I. Settings

**67. `/settings`** — the letterhead. Fill in address, phone, email, taxId, rcNumber.

**68. [gate] Clear a letterhead field you filled in, and save.** It is actually cleared. Omitting
means "leave alone" and an empty string means "clear"; a form has to be able to do both.

**69. [gate] Currency, timezone and invoice numbering cannot be changed here.**

**70. Download an invoice PDF now.** **[gate] The letterhead is on it**, and every active bank
account is printed, default first.

**71. `/settings/hours`** — set opening hours and working days.

**72. [gate] Try to save with no working days selected.** Refused, with a message saying what it
would do. An empty `workingDays` on the *organization* means no day is a working day and locks out
every member of staff.

**73. [gate] On a member of staff, an empty working-days means "follow the business"** — the
opposite, and correctly so, because a membership has something to fall back to.

**74. `/settings/staff`** — add a member of staff. **[gate] They get a username qualified by the
org slug and no email is required.** Most cashiers in this market have no working address.

**75. Reset that person's password.** **[gate] Their sessions are revoked** — check by having
their tab make a request. The owner believes they have just locked that person out.

---

## J. The role pass

**This is the section most likely to find something**, because every screen above was checked as
the owner, and the owner sees everything.

**76. Sign out. Sign in as `bola@adebayo-stores-f84554` / `password123`** — a `sales_rep`.

**77. [gate] The first screen after signing in is usable.** Not a red error box, not an empty
frame. A rep may not read `GET /reports/dashboard` at all, and the nav correctly hides Home — but
sign-in lands on `/` regardless.

**78. [gate] Walk every nav item the rep is offered.** Each renders something real.

**79. [gate] Type `/reports` into the address bar as the rep.** Whatever happens, it is not a dead
end — there is a way back to a screen that works.

**80. [gate] Type a route that does not exist as the rep.** Same question: the fallback has to land
somewhere usable.

**81. [gate] On `/sales`, every cost and margin column is an em dash** — `redactCost` removes the
key, so a `₦0.00` is a bug. A zero reads as "free goods" to anything that sums it.

**82. [gate] Open a sale as the rep.** The header's cost total is redacted too, not just the lines.
The same numbers summed, next to the total they sold at, is the margin — that leak survived a
sweep that had already been through this endpoint.

**83. [gate] Ring up a sale at the till as the rep.** It works. The till is a rep's daily job.

**84. [gate] Sell more than is in stock as the rep.** They see the refusal and **no override
dialog** — forcing a movement through a shortfall is a decision, not daily work.

**85. Repeat 76–84 as a `storekeeper`**, whose daily job is receiving deliveries rather than
selling.

---

## K. The §18 regression checks

Short version of the bug classes that were invisible to every automated check. If you only have
ten minutes, do these.

| # | Check | What it catches |
|---|---|---|
| 86 | Type a long number into every money box, digit by digit | A field that rewrites what you are typing |
| 87 | Backspace every number box empty | A validator that cannot accept the empty string |
| 88 | Look at every row of side-by-side form boxes | A width that was silently discarded |
| 89 | After every write, does the screen behind it update? | A cache that was told the wrong thing to refetch |
| 90 | Every detail screen has a working back link | A dead end |
| 91 | Every figure is money, a percentage, or a dash | `NaN` from an absent cost key |
| 92 | Phone width on every screen | Layout that only ever ran at desktop width |

---

## What to do with what you find

Write it down as you go rather than fixing as you go — a sweep that stops to fix finds the first
bug and not the seventh. The §18 record is the format: what the screen did, what it should have
done, and the general rule underneath it, because the rule is what stops it coming back.
