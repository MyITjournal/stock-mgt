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
**[gate] The screen says out loud that this raises a bill on *Bills*.** The goods value on a receipt is not what is owed.

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

**66. `/reports/targets`** — **[gate] targets are a category and a number of cartons**, with no
product or money box. (Product targets, and the rollup bug they could cause, were removed on
2026-10-04 — section Y walks the new shape.)

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

---

## L. Sign-up (added with §22)

The screen a real customer meets first, and the only one they see before deciding whether to
bother. Sign out before starting.

**93. Go to `/sign-in` and click "Create one".** [gate] The link is there and reaches `/sign-up`.

**94. Create a shop** with a name, your name, a username and a password, leaving the email blank.
**[gate] You end up signed in and inside the app**, not back at a login screen.

**95. [gate] The new shop works immediately** — open the till, add a product, ring up a sale.
A shop created this way must be indistinguishable from one created any other way: it needs its
default price tier and a location, or nothing can be priced or stocked.

**96. Sign out and sign back in with that username.** [gate] It works, and the username is the
plain one you chose — not `yourname@shop-slug`.

**97. [gate] Try to create a second shop with the same username.** Refused, saying the username is
taken — not a silent second account, and not a server error.

**98. [gate] Try a username with a space or an `@` in it.** Refused before it is sent.

**99. [gate] Read the email box's hint.** It must say that nothing is sent to it and that it is
what lets you reset your own password later. This is the one irreversible choice on the form and
the person making it has to understand it.

**100. Create a shop *with* an email.** [gate] It is accepted and you are signed in the same way.

**101. [gate] On a phone-width window, the whole form is usable** — every box reachable, nothing
cut off, the button visible without scrolling sideways.

---

## M. The landing page and the moved home screen

`/` is now the landing page and the dashboard's home moved to `/home`. That is the same shape of
change as §19's bug — three paths deciding where somebody goes — so these are the gates.

**102. Signed out, open `/`.** [gate] The landing page, not a password box. Headline, two buttons,
no error.

**103. [gate] Signed out, open `/home`.** You are sent to sign in, not shown an empty frame.

**104. Sign in as the owner.** [gate] You land on the dashboard home — and the address bar says
**`/home`**, not `/`.

**105. [gate] While signed in, type `/` in the address bar.** You are sent straight to your own
starting screen. **It must not flicker the landing page first, and it must not loop.** This is the
one that would break if any signed-in role ever resolved to `/` again.

**106. [gate] Signed in as a sales_rep, type `/`.** You land on the till. As a storekeeper, on
stock. Neither sees the landing page, neither sees the dashboard home.

**107. [gate] Signed in, type a nonsense URL.** You land on your own starting screen, not the
landing page and not an error.

**108. [gate] Signed out, type a nonsense URL.** You land on the landing page.

**109. From the landing page, click "Create your shop"**, then from sign-up click "Sign in", then
click the **Reho** wordmark. [gate] All three links go where they say, and the wordmark returns you
to `/`.

**110. [gate] The Home tab in the nav still works and is still hidden from a rep.** It points at
`/home` now; a rep must not see it at all.

**111. [gate] On a phone-width window the landing page is usable** — headline readable, buttons
reachable, nothing cut off sideways.

---

## N. Removing a category or packaging type

The screen used to add these and never remove them. A category with products in it is refused on
purpose — the alternatives leave screens disagreeing or rewrite past reports (DECISIONS §4).

**112. As the owner, open Categories & tiers.** [gate] Every category and packaging type has a
**Remove** button, and a note under each list says what removing means.

**113. Click Remove on an empty category.** It asks *"Remove Toys?"* with **Remove** and **Keep**.
Click **Keep**. [gate] Nothing is removed.

**114. Click Remove, then Remove again.** [gate] It leaves the list, and it is gone from the
category picker on the product form and the filter on the products list.

**115. Add the same name again.** [gate] It is accepted — no "already exists" error for a category
you cannot see.

**116. Remove a category a product is in.** [gate] It stays, and a red message says how many
products are in it and to move them first. Move the product to another category, try again, and
it goes.

**117. [gate] Signed in as a sales_rep or storekeeper**, the page shows the lists with no Remove
buttons.

---

## O. Taking back a unit or price added by mistake

A row added on the product form and not yet saved can be removed. A saved one still cannot (§4).

**118. Add a product, click Add unit twice, then × the first new row.** [gate] That row goes, and
the one below it keeps what you typed in it — its name and factor do not jump up a row.

**119. [gate] The base unit (`piece`) has no ×**, even on a brand-new product.

**120. Add a price on a new unit, then × the unit.** [gate] Its price row goes with it.

**121. Add two prices, type an amount in the second, × the first.** [gate] The amount you typed
stays on the row you typed it in.

**122. Save, then edit the product.** [gate] The saved units and prices have no ×. Click Add unit
— the new, unsaved row does have one.

---

## P. Product size, and stock on the products list

**123. Add a product with Size `400g`.** [gate] The products list shows `400g` beside the name,
in lighter text, and nowhere on the list can it be edited.

**124. Type `400g` in the products search.** [gate] It finds that product even though `400g` is
not in its name.

**125. At the till, search for it and add it.** [gate] The search result and the cart line both
show `400g` beside the name, and the cart offers no box to change it.

**126. Finish the sale.** [gate] The receipt shows `400g` beside the name.

**127. Edit the product and empty the Size box, then save.** [gate] The size is gone from the
list — clearing works, it does not silently keep the old one.

**128. [gate] The products list has an On hand column.** A product with a delivery recorded shows
the quantity and its base unit; one with none shows a grey 0; a service shows a dash.

---

## Q. What kind of shop

**129. Open sign-up.** [gate] "What kind of shop is it?" is a drop-down reading **Choose one…** —
**nothing is pre-selected**, and Create shop stays disabled until one is picked. It offers Retail
shop, Wholesale or distributor, and Both; picking one shows a line under it saying what it means.

**130. Create a Wholesale shop.** [gate] Categories & tiers shows one price list, *Wholesale*,
marked default.

**131. Create a shop as Both.** [gate] Two price lists, *Retail* (default) and *Wholesale*.

**132. Settings → Business, as the owner.** [gate] A "How you trade" section shows the type you
chose. Change it and save — it says saved, and the price lists on Categories & tiers are unchanged.

**133. [gate] The same screen as a sales_rep** shows the type as text, with nothing to change.

**134. [gate] On a phone** the sign-up drop-down opens the phone's own picker and the whole form
fits without sideways scrolling.

---

## R. Counted in, and sold at the till

Run these in a shop created as **Wholesale** unless a step says otherwise.

**135. Add a product.** [gate] The first unit row says **counted in**, not "base unit". Rename it
`sachet`, add `roll` (10) and `carton` (210). Without touching any box, the sachet's **Sold** box
is unticked and the other two are ticked.

**136. [gate] "Till picks first" offers only roll and carton**, plus *Automatic — the biggest sold
unit*. Save. The products list shows `sachet (not sold)` in the Units column.

**137. Edit it and untick every Sold box.** [gate] An amber note says to tick at least one, and
Save is disabled.

**138. At the till, search for it and add it.** [gate] It goes in as a **carton**, and the unit
picker on the line offers roll and carton — never sachet.

**139. Scan the sachet's barcode.** [gate] A message says it is not sold by the sachet and to scan
the pack or carton. Nothing is added to the cart.

**140. Scan a carton or roll barcode, then open the line's unit picker.** [gate] After a moment it
offers the product's other sold units too — this used to stay stuck on the one scanned.

**141. Record a delivery of it, counted in sachets.** [gate] The delivery form still offers
sachet — counting is not selling.

**142. In a shop created as Retail, add a product with piece and carton.** [gate] Both boxes start
ticked, and *Automatic* says *the smallest sold unit*.

---

## S. Adding a portion

**143. Add a product counted in `sachet`, with `roll` (10) and `carton` (210).** [gate] An *Add a
portion* row appears under the units, offering ½ ⅓ ¼ ⅙ of a roll or a carton — never of the
sachet.

**144. Pick ½ of a carton and click Add.** [gate] A new row appears named **`1/2 carton`** with
factor **105**, its Sold box ticked. Do the same for ⅙ — `1/6 carton`, factor 35.

**145. Click Add again for ½ of a carton.** [gate] A red line says the product already has one.

**146. Start another product counted in `roll` with `carton` (21), and ask for ½ of a carton.**
[gate] It is refused, saying ½ of a carton is **10 and 1/2 rolls**, and suggesting you count in
something smaller.

**147. Save the first product with a price on `1/2 carton`, then sell one at the till.** [gate]
The cart shows `1/2 carton` at its own price, and the receipt prints `1/2 carton`.

**148. Print that sale's PDF invoice.** [gate] The unit reads `1/2 carton` — no missing
character where the fraction is.

---

## T. No base price, no guessing

**149. Add a product counted in `sachet` with `carton` (210) and a `1/2 carton` portion. Leave
"Price per sachet" empty and price only the carton.** [gate] It saves. The hint under the empty box
says a unit with no price cannot be sold until it has one.

**150. At the till, add it and switch the line to `1/2 carton`.** [gate] A message says it has no
price for the 1/2 carton yet; the line stays a carton at the carton price.

**151. Scan a barcode on the `1/2 carton`.** [gate] The same message, and nothing is added.

**152. Give the 1/2 carton a price on the product, then sell one.** [gate] It goes in at that
price.

**153. Edit an older product that has a base price, empty the box, save.** [gate] Its unpriced
units now refuse at the till; type a price back in and they sell again.

---

## U. On hand in the shop's units

**154. Record a delivery of 14 cartons, 2 rolls and 5 sachets of a product counted in sachets
(roll 10, carton 210).** [gate] The products list's On hand reads **14 carton, 2 roll, 5 sachet**.
Hovering it shows **2,965 sachet in all**.

**155. Give the product a `1/2 carton` portion and sell one.** [gate] On hand reads **13 carton,
13 roll** — never "1/2 carton".

**156. [gate] A product that has sold past its stock** shows its shortfall in red, signed once in
front: **−1 carton, 2 roll**.

---

## V. Naming a customer re-prices the cart

Use a shop created as **Both**, with a product priced on Retail **and** Wholesale, a second priced
on Retail only, and a customer on the Wholesale list.

**157. Ring up both products with no customer.** They go in at Retail prices.

**158. Pick the wholesale customer.** [gate] The first product's line **changes to its Wholesale
price** and a note says prices moved to the Wholesale list. The second keeps its price and a red
message names it as having no Wholesale price.

**159. [gate] While the prices are changing, Take payment is greyed out.**

**160. Type your own price on a line, then switch the customer back to walk-in.** [gate] Your
typed price stays; the other lines go back to Retail.

**161. Pick a customer, then quickly pick a different one.** [gate] The cart ends on the second
customer's prices, never the first's.

---

## W. Suggestions as you type

**162. At the till, type two letters of a product's name and stop.** [gate] Suggestions appear
within a moment, **without pressing Enter**, each with its price and the unit it is priced per.

**163. Tap a suggestion.** [gate] It goes into the cart **at once** — no "Looking that up…" pause —
and the box empties.

**164. Type again, use the down arrow to highlight the second suggestion, press Enter.** [gate]
That one is added, not the first.

**165. Scan a barcode (or type its number fast and press Enter).** [gate] It is added as before —
the suggestions do not get in the way.

**166. Type something that matches nothing.** [gate] A line says nothing matches yet and to press
Enter to try it as a barcode. Escape clears the box.

**167. [gate] On the live site, time a pick from typing to the line appearing.** It should be
about the time of one request, not three.

---

## X. The phone camera

Run these **on a phone, on the live site** — cameras only open on a secure (https) address.

**168. Add a product. In the Barcodes section, tap Camera beside the carton and point it at a
carton's barcode.** [gate] The phone beeps, the number fills the box, and the camera closes. Do
the same for the roll. Save — reopening the product lists both codes.

**169. Point the camera at a wrong or damaged code, or type one digit wrong.** [gate] Saving says
the check digit does not match, and nothing is saved.

**170. At the till, tap Scan with camera.** [gate] The camera opens at the top of the screen and
the phone's keyboard does **not** pop up.

**171. Scan four different products in a row.** [gate] Each beeps and is added. After each, the
**Just scanned** strip shows that item with its unit and quantity — change Peak to *1/6 carton*
there. The camera never closes in between.

**172. Hold one carton in front of the camera for several seconds.** [gate] It is added **once**.
Move it away and back after a couple of seconds — it is added again (quantity 2).

**173. Scan a code that is on no product.** [gate] A note says it is not on any product yet; the
camera stays open.

**174. Tap Done.** [gate] The camera closes, the full cart and payment are there, and the light
on the phone's camera goes off.

**175. Refuse camera permission when asked.** [gate] The till explains how to allow it in the
browser's settings rather than showing a blank box.

---

## Y. Vendor targets in cartons

Use a shop created as **Wholesale** (or Both), with a *Lotion* category holding a product whose
carton is 12 and another whose carton is 24.

**176. Reports → Targets → Set a target.** [gate] The form asks only for a vendor, a category, a
month, a number of **cartons** and a note — no product, no unit, no money.

**177. Set 112 cartons of Lotion for this month, then record deliveries of 10 cartons of the first
product and 5 of the second.** [gate] The target reads **15 of 112 cartons** — five cartons of 24
count as five, not ten.

**178. Record a delivery of a lotion that has only one unit (pieces).** [gate] The target does not
move, and an amber line names that product as having no carton set up.

**179. Tap Edit on the target.** [gate] The vendor, category and month are shown but cannot be
changed; change the cartons to 100 and save — the target reads **of 100**.

**180. Open the home screen.** [gate] A *Vendor targets this month* section shows a ring for the
target, its percentage in the middle and *"15 of 100 cartons"* under it. A met target says
*Target met* in words.

**181. [gate] In a shop created as Retail**, Reports has no Targets tab, and the home screen has
no targets section.

---

## Z. The Reho wordmark

**182. [gate] Signed in as the owner, open any screen and click Reho at the top left.** You land on
the dashboard home.

**183. [gate] Signed in as a cashier (sales_rep), click Reho.** You land on the till — never on the
dashboard, which a cashier cannot see.

---

## AA. Printing an invoice

**184. On a computer, ring up a sale at the till.** [gate] "Sale recorded" shows a **Print
invoice** button above New sale. Clicking it opens the computer's print dialog with the invoice
in it — no new tab.

**185. Open that sale from Sales.** [gate] **Print invoice** sits beside Invoice PDF and does the
same.

**186. [gate] On a phone, tap Print invoice.** The invoice opens in the phone's viewer, where its
Print or Share button sends it to a printer or WhatsApp.

**187. [gate] Leave the till open past fifteen minutes, then print.** It still prints the invoice,
not a sign-in error.

---

## AB. Adding a customer at the till

**188. [gate] Put something in the cart, then press + New beside Customer.** A small form asks
for a name and a phone number — nothing else, no price list. Fill in a name and press **Add and
use for this sale**. The form closes, the new customer is already chosen for the sale, and the
prices in the cart do not move.

**189. Take payment on credit.** The sale goes through in the new customer's name; open
Customers and they are there, owing the balance.

**190. Signed in as a cashier, do 188 again.** It works the same — adding a customer is not
limited to a manager.

---

## AC. A new category from Add product

**191. [gate] Open Add product, type a name and a price, then press + New beside Category.** A box
replaces the drop-down. Type `Seasoning` and press **Enter**. The product is **not** saved yet; the
drop-down comes back with **Seasoning** chosen, and everything typed above it is still there.

**192. Save the product.** It is filed under Seasoning, and Seasoning appears on *Categories &
tiers*.

**193. Press + New again and type `seasoning` (lower case).** Nothing new is created — the
existing Seasoning is picked.

**194. Remove a category on *Categories & tiers* that has no products, then add it again from the
product form.** It comes back and is picked, with no error.

---

## AD. The VAT switch

**195. [gate] As the owner of a shop that existed before this change, open Settings → Business.**
*Do you charge VAT?* reads **Yes**, because that is how the shop has behaved until now.

**196. [gate] Switch it to No and save, then ring up a sale at the till.** "Sale recorded" shows the
total with **no "of which VAT" line**. Open the sale from Sales: no VAT line there either, and
**Print invoice** prints none.

**197. Open a sale made before the switch.** It still shows its VAT — switching does not rewrite
what was already sold.

**198. Open Add product.** There is no VAT rate box while VAT is off.

**199. Reports → Profit for today, with only no-VAT sales in it.** The first line reads **Sold**
(not "Sold, including VAT") and there is no "Less VAT" line.

**200. Switch VAT back to Yes and sell again.** The new sale shows "of which VAT" and the product
form has its VAT box back, still on the rate each product had.

**201. Create a new shop from the sign-up screen.** Its Settings → Business reads **No**.

---

## AE. Importing products from a spreadsheet

**202. [gate] As an owner, open Stock → Products.** There is an **Import from spreadsheet** button
beside Add product. Signed in as a cashier, it is not there.

**203. Press it, then Download the template.** A `reho-products-template.csv` downloads. It opens
in Excel or Google Sheets with the column names (Unit 2 to Unit 5) and three example rows: a lotion
sold in parts of a carton, a roll-on, and Indomie.

**204. [gate] Upload the template untouched.** The preview says **3 to add**. Even Glow lists
piece and carton of 12 as *counted, not sold*, and 1/2 carton of 6 at ₦29,900.00 and 1/4 carton of
3 at ₦14,950.00 as sold. Dry Impact lists pack of 6, 1/2 pack of 3, carton of 30 and 1/2 carton of
15, all sold. **Nothing is in Products yet.**

**204a. [gate] Add a Unit 6 column yourself and fill it for one row.** It is read, not ignored.
Write "1/2 carton" against a carton of 15: the row is red, saying ½ of 15 is 7.5.

**205. In Excel, add a row with Unit 2 "carton" and Unit 2 how many `0.5`, and one whose price is
`two hundred`; save as .xlsx and upload.** Those rows are red with the reason in words, and
**Add products** is disabled with "Fix the rows marked in red".

**206. [gate] Fix them, upload again, press Add.** "N products added". Open Products: they are
there, under their categories, and a carton at the till rings up at its own price.

**207. Upload the same file again.** Every row reads **Skipped — already in your products**, and
nothing changes.

**208. Type a 13-digit barcode into a General-formatted cell in Excel and save as .csv.** The row
says the spreadsheet rounded the barcode and to format the column as Text. Doing that and saving as
.xlsx imports it, and scanning it at the till finds the product.

**209. In a wholesale shop, import Peak 14g.** The sachet shows "counted, not sold" and the carton
"first at the till".

---

## AF. Opening stock

**210. [gate] As an owner, open Stock → On hand.** There is an **Opening stock** button. Signed in
as a cashier, it is not there.

**211. Press it.** Every product with no stock yet is listed, each starting on its biggest unit
(carton). A product that already has stock is not on the list.

**212. [gate] Type 14 against Peak 14g's carton but leave the cost empty.** The line says "What did
one carton cost?" and Save is disabled with "1 line needs a cost".

**213. Type ₦14,000, press + loose, and enter 3 rolls at ₦900. Save.** "Opening stock saved for 1
product, worth ₦198,700.00." Peak 14g leaves the list.

**214. [gate] Open Money → Bills.** Nothing new is owed — no bill was raised. Reports → Purchases
and the vendor targets do not move either.

**215. Open Stock → On hand and Peak 14g's lots.** 2,270 sachets in two lots coded **Opening**,
the carton lot with its expiry. Reports → Stock shows them at ₦198,700.00.

**216. Sell a carton at the till, then open Reports → Profit.** The cost of that carton is
₦14,000.00, not an estimate and not zero.

**217. In a shop with two locations,** the sheet asks **Which location**, and a product stocked
at one is still offered at the other.

---

## AG. Invoices, Bills, and what each payment paid

The Money tabs were renamed on 2026-10-05: Owed to us → **Invoices**, Payments → **Money in**,
We owe → **Bills**, Paid out → **Money out**, Accounts → **Bank accounts**. The addresses did not
change.

**218. [gate] Open Money.** The tabs read Invoices, Money in, Bills, Money out, Expenses, Bank
accounts. Home shows **Unpaid invoices** and **Unpaid bills**.

**219. [gate] Bills → Unpaid, open a vendor, press Mark as paid on a bill.** The form is titled
**Mark as paid**, the amount is the whole balance, and **Paid on** is today and cannot be set to a
later day. Set Paid on to a day in June and record it. The bill leaves Unpaid.

**220. [gate] Bills → All bills.** That bill is there marked **Paid**, with Billed, Paid and Owing.
Click it: the payment is listed with its June date and method, and the payments add up to Paid.

**221. Pay part of another bill with Pay part.** In All bills it reads **Part-paid**.

**222. [gate] Money out.** Each payment's **Against bill** opens the bill it paid. A voided
payment is struck through here and is **not** listed on its bill.

**223. [gate] Invoices → All invoices.** Every invoice is listed newest first with Unpaid,
Part-paid or Paid. Press **Mark as paid** on an unpaid credit invoice: the form names that invoice,
the amount is what it owes, and recording it turns the row **Paid**.

**224. Money in.** The payment just recorded lists the invoice it settled as a link, with the amount
that went to it, and the link opens the invoice.

**225. Record a customer payment with Paid on set to last Friday.** Money in shows it dated Friday.

---

## AH. Downloading to Excel

**226. [gate] Open any screen with a Download button, then reload with the browser's network
panel open.** Nothing named `browser-…js` (the Excel writer) loads until **Download** is pressed.

**227. [gate] Stock → Products → Download.** An `.xlsx` opens in Excel with the import template's
columns, filled in. A 13-digit barcode reads in full — not `6.154E+12` — and prices are numbers
Excel can add up.

**228. Upload that same file through Import from spreadsheet.** Every row reads **Skipped —
already in your products**. (Changing prices by re-uploading is a later step.)

**229. Stock → On hand → Download.** One row per product and location, with on hand and the
soonest expiry. There is no value column; Reports → Stock → Download has value.

**230. [gate] Reports → Profit, Sales, Purchases, Money in, Movers and Stock → Download each.**
Each file has the tables the screen shows, a tab each, and a **Period** tab saying which period.
The totals match the screen.

**231. [gate] Signed in as a cashier, download Sales by product.** The cost, gross profit and
margin columns are **empty**, not zero.

**232. Money → Invoices → All invoices → Download, and the same on Bills → All bills, Money in and
Money out.** Each file holds the whole list, not only the page on screen, with Unpaid / Part-paid /
Paid and, on the payment lists, which were voided.

---

## AI. Vendor rebates

**233. [gate] Reports → Targets for this month, Record expected rebate.** Pick a vendor and enter
₦150,000. Under *Rebates this month* it reads **Expected ₦150,000.00**, with "n of m targets met"
beside it when that vendor has targets. Recording a second for the same vendor and month is
refused.

**234. [gate] Money → Bills → All bills, open a later bill from that vendor.** It says the vendor has
a rebate expected. **Apply rebate to this bill**, change the amount to ₦140,000 and apply. The bill
shows **Billed · Paid · Rebate ₦140,000.00 · Still owing** — owing lower by exactly that — and lists
the rebate as **Credited ✓**.

**235. Back on Targets.** The rebate reads **Credited ✓ ₦140,000.00**, off that bill, expected
₦150,000.00.

**236. [gate] Reports → Profit for the bill's month.** A **Plus vendor rebates ₦140,000.00** line sits
between Gross profit and Less expenses. Gross profit and margin did not change; After expenses
went up by ₦140,000.

**237. [gate] Money → Money out.** Nothing new: a rebate is not a payment.

**238. Apply a rebate larger than a bill owes.** Refused, naming both amounts. Apply one to another
vendor's bill: not offered, and refused by the server.

**239. Remove credit on the bill.** The bill owes ₦140,000 more again, the rebate reads Expected,
and the Profit line goes.

---

## AJ. A vendor's money target

**240. [gate] Reports → Targets → Set a money target.** Pick a vendor, enter ₦12,000,000 and leave
**This vendor adds 7.5% VAT on top of their invoices** ticked. A ring appears under *Money targets
this month*, saying "Money target, before VAT".

**241. [gate] Record a delivery from that vendor worth ₦12,900,000 this month.** The ring reads
**Target met** at 100% — ₦12,000,000 of ₦12,000,000 — because VAT came off the invoices.

**242. Change it and untick the VAT box.** The ring now counts the full ₦12,900,000 and reads
**Over target**.

**243. Setting a second money target for the same vendor and month** is refused.

**244. [gate] Home.** The money ring sits beside the carton rings under *Vendor targets this month*.

**245. Under *Rebates this month*,** that vendor's row says "money target met" next to the carton
count. Recording the rebate still works whether or not it is met.

---

## AK. Correcting a delivery

**246. [gate] Receive a delivery of 7 cartons, then open it in Stock → Deliveries.** As an owner or
manager there is **Correct this delivery**; as a cashier there is not.

**247. [gate] Correct it to 6.5 cartons received and 6 paid for, with the value of 6 cartons, and a
reason.** Press **Check**: it says how many pieces leave stock, the change in value, and the bill
before → after. Nothing has changed yet — On hand and the bill are as they were.

**248. Save.** The line now shows the true figures (in pieces, since 6½ cartons is not whole); On
hand dropped by half a carton; the bill moved by the difference; and a *Corrections* section lists
the reason, who, when, and received / paid for / value before → after.

**249. Correct it again, back to 7 cartons.** Allowed; the line reads cartons again, stock and the
bill return, and both corrections are listed.

**250. Try 0.5 of a carton of 15.** Refused, saying it is 7.5 pieces and to enter it in pieces.

**251. Correct a delivery whose bill is already paid in full to a lower value.** Refused: void the
payment that was too much first.

**252. [gate] Receive a delivery typing 9.5 cartons received, 9 paid for.** It records, in pieces,
with the half carton as free goods.

---

## AL. Pay later at the till

**253. [gate] Ring up a sale, tick Pay later.** Method, Paid into, Reference and Amount paid
disappear; the amber box reads **All on credit** with the total; the button reads **Record sale
on credit**. With no customer chosen the button stays off and the box says a credit sale needs a
customer.

**254. Choose a customer and record it.** The sale is recorded with nothing paid; Money → Invoices
lists it **Unpaid**, and Money in shows no payment for it.

**255. [gate] Ring up a second Pay later sale for the same customer, as a cashier.** Refused — they
still owe. As an owner or manager, the refusal asks for a reason and records it.

**256. Untick Pay later.** The money boxes come back empty, and a normal cash sale works as before.

**257. [gate] Open Money → Invoices → All invoices.** The sale from step 254 has a **Due** date five
days after it was made. A sale paid in full shows **—**.

**258. [gate] Sign in as a cashier and open the Till.** A **Payments due** line sits above the cart
once something is due within two days or overdue. A sale made today is not due for five days, so
this needs an older unpaid invoice — the migration gave every one still owing a due date.
**Show** opens it: customer, phone, invoice number, amount owed, and *N days overdue* in red, *Due
today* in amber or *Due in N days*. Tapping the phone number on a phone offers to call; the invoice
number opens the sale.

**259. As an owner, open Home.** The same list sits at the top, already open.

**260. Record a payment against one of those invoices.** It leaves the list. Void that payment and
it comes back. When nothing is due, the panel is gone from both screens.

**261. [gate] Money → Invoices → Unpaid, open a customer.** Each invoice reads *N days overdue*
(red), *Due today* (amber) or *Due in N days* instead of "8d". The customer's own page says the
same.

**262. [gate] Open a credit sale and download its PDF.** Under the date: **Payment due by** and the
day — the same day the panel counts from. A paid sale's PDF has no such line. The till's "Sale
recorded" receipt for a Pay later sale shows it too.

**263. Download the customer's statement.** The last column is **Due**: the date, with *N days
overdue* under it once late.

**264. Invoices → All invoices → Download.** The sheet has a **Due** column, empty for paid ones.

**265. [gate] Print an invoice from a sale.** The PDF is **A5** (half an A4 sheet): letterhead,
lines, totals and the accounts to pay into all fit, nothing cut off at the right edge. An invoice
with many lines runs onto a second A5 page. The customer statement is still A4.

---

## AM. A shop's currency

**266. [gate] Sign up a new shop and leave Currency on naira.** Every amount reads ₦ as before.
Settings → Business shows Currency and Time zone as boxes you can change, with a note saying until
when.

**267. [gate] Sign up another shop choosing Ghanaian cedi.** Before adding anything, Settings →
Business shows **GHS** and your own time zone. Add a product with a price: the till, products list,
invoices and reports all read **GH₵**, and its PDF invoice reads **GHS 45.00**.

**268. [gate] Back in Settings → Business for that shop.** Currency and Time zone are now under
*Fixed for this business*, with a line saying why. Saving the letterhead still works.

**269. Sign up a third shop, choose US dollar, then switch it to Kenyan shilling in Settings before
adding anything.** It saves, and the first product priced afterwards reads **KES**.

---

## AN. Who was paid, and salaries

**270. [gate] Money → Expenses → Record an expense.** **Paid to** is a box to type in, first on the
form, and the button stays off until it has a name. There is no "Nobody in particular" and no list
of vendors. **What for** does not offer *salaries*. A **Paid on** date is there for something paid
earlier.

**271. Record one, then open the form again.** The name you typed is offered as a suggestion. The
list shows it under Paid to, and the note beside it.

**272. [gate] Money → Salaries → Pay a salary.** No category to pick. Record one for a member of
staff: it appears on Salaries and **not** on Expenses.

**273. [gate] Reports → Profit for this month.** *Less salaries* and *Less other expenses* are two
lines, and operating profit has come down by the salary.

---

## AO. Sales: the till and its history, and a sale's date

**274. [gate] The top bar has one Sales item, and no separate Till.** It opens the till, with
**Till** and **History** tabs above it; History is the list of sales. Opening a sale from History
keeps Sales highlighted. A cashier still lands on the till after signing in.

**275. [gate] As an owner, the till shows Sale date set to today.** Pick yesterday: the bar turns
amber, names the day, and offers **Back to today**. Ring up a cash sale. In History it shows
yesterday's date; Reports → Collections for yesterday includes its payment; today's does not.

**276. Ring up a second sale without touching the date.** It is dated yesterday too. Press **Back to
today**: the bar goes plain and the next sale is today's.

**277. [gate] As a cashier, the till has no Sale date.** Their sales are always today's.

---

## AP. Margins

**278. [gate] Reports → Margins.** One row per product and selling unit, thinnest margin first:
Price, Cost, Margin (amount and %), Last delivery. Anything below cost is red; the rest is plain.
A product never delivered reads **no cost yet**, a unit with no price **no price** — neither as 0.

**279. [gate] Receive a delivery with free goods** (e.g. 13 cartons, 12 paid for). Its row's Last
delivery shows the cheaper cost and **13 for 12**; Cost moves toward it as the new stock joins
what is on the shelf.

**280. Switch Price list to Wholesale, then a category.** Prices and margins follow; **Download**
gives the same table in Excel.

**281. [gate] As a cashier or rep, Reports is not in the top bar** and `/reports/margins` shows
nothing — buying prices stay closed.

---

## AQ. Till and delivery corrections

**282. [gate] At the till, each line has − and + beside its quantity.** + adds one, − takes one
away and stops at 1. On a computer the cursor goes back to the search box after each tap.

**283. [gate] Type a name, pick a suggestion.** The item is added and the cursor is back in the
search box, ready for the next item. Type a quantity and press Enter: the cursor goes back too.

**284. [gate] Put three items in the cart and refresh the page.** A blue note says the sale was not
saved and has been brought back, with the same items, customer and payment choices. **Clear**
empties it for good; a sale that is taken leaves nothing to bring back.

**285. [gate] Stock → Deliveries → Record a delivery: fill in a vendor and two products, then
refresh.** The form comes back as it was, with the same note. **Cancel** throws it away. The button
under the lines reads **Add a product**.

**286. Settings → Staff.** The button reads **Add a staff**; the form's button reads **Add staff**.

**287. [gate] On the hosted site, record a delivery with twenty or more lines.** It saves — it
used to fail with an internal server error once it took longer than five seconds.

---

## AR. Sorting, and the price on the products list

**288. [gate] Stock → Products, as an owner.** The column is **Price**, not Base price: each row
shows its selling unit's price, e.g. "₦12,500 / carton". A product with no price at all reads
**no price** — hovering it says nothing about your role. Cost reads "₦4,027.00 / piece".

**289. [gate] Tap the Price heading.** Cheapest first, with an ↑; tap again for dearest first (↓);
a third tap puts the list back. Rows with no price stay at the bottom either way. Name, On hand
and Cost work the same, and still within whatever the search and category have narrowed to.

**290. Customers.** A search box finds by name, phone or email; Name and Owes sort.

**291. Stock on hand → Sort by: Most on hand / Least on hand / Name.**

**292. Reports → Margins, Sales, Purchases, Stock and Movers.** Headings with ↕ sort that table.
History lists (sales, payments, deliveries, movements) do not offer sorting.

**293. [gate] Stock → Products on a shop that sells by the carton.** Cost is in the same unit as
Price — "₦12,500 / carton" beside "₦9,664 / carton" — not per piece. Open the product: *Price* and
*Last cost* name the same unit. A product never delivered reads **none yet**.

**294. [gate] Pick a product at the till and note the unit it lands on.** Its row on Stock → Products
shows Price and Cost in that same unit, at the price the till charged. A product whose till unit
has no price reads **no price** — the till refuses it too.

---

## AS. Margins in one row, and opening stock in one line

**295. [gate] Reports → Margins.** One row per product, in its biggest unit sold (the carton) —
not a row each for 1/2 pack, pack and carton.

**296. [gate] Stock on hand → Opening stock.** Type **6.25** against carton for a product with 12
in a carton: accepted, one line. Type **6.1**: the line says it is not a whole number of pieces
and Save stays off. The cost box says **per carton** beside it, all the time.

**297. Type a cost, then change that line's unit.** The cost empties and asks again.

---

## AT. Correcting an opening lot's cost

**298. [gate] Stock on hand → expand a product with opening stock, as an owner.** The *Opening*
lot has **Correct cost**; a delivered lot does not. A cashier sees no such link.

**299. [gate] Correct cost: pick 1/2 pack, type 12,433.36.** The blue line shows what the lot was
worth and what it will be. Save stays off until there is a reason. Save: *Cost each* on the lot
changes, the quantity does not, and Reports → Margins moves to match.

**300. Change the unit after typing a cost.** The cost empties and asks again.

---

## AU. A delivery line that was the wrong product, or never came

**301. [gate] Deliveries → open one → Correct this delivery.** Each line has a small **Wrong
product?** link and nothing else new.

**302. [gate] Tap it and type the right product's name; pick it.** The recorded name is struck
through, the right one beside it with **undo**, and the unit boxes are the right product's. Check:
it says how many of the wrong product come out of stock and how many of the right one go in, and
the value is unchanged. Save: the delivery line names the right product; Stock on hand shows the
wrong one down and the right one up.

**303. Set a line's received, paid for and value to 0.** Check, then save: it is accepted (it used
to say "At least one piece"), its stock comes out and the bill drops by its value.

---

## AV. One line per item in "Decisions somebody made"

**304. [gate] Reports → Stock → Decisions somebody made, for a period with opening stock.** A
product entered as cartons plus loose pieces is one line with the quantities added up (e.g.
+192), and the time cell says "2 entries added up". A damage write-off of the same product is its
own line, and so is anything marked **forced**. *Movements* above still counts every entry.

---

## AW. Stock in and out

**305. [gate] Reports → Stock, this month.** *Stock in and out* lists each product: Opening,
Delivered, Sold, Adjusted, Total — in cartons and pieces, the exact count on hover. Pick a
product and check: opening + delivered − sold ± adjusted is the Total, and the Total is what Stock on
hand shows.

**306. A product whose opening stock was entered this month** shows it under Opening, not
Adjusted. A corrected delivery shows what really arrived under Delivered.

**307. Change the period at the top to last month; use the search box; tap a heading to sort.**
Download: the workbook has an *In and out* tab.

**308. [gate] Reports → Stock → Stock in and out → Value, as an owner.** A line above the table
reads Opening stock + Delivered − Sold, at cost ± Adjusted = Stock value, and Stock value is the
same figure as the stock value at the top of the page. Opening stock shows what was entered for
it. As a cashier there is no Value switch. Download: the *In and out* tab has value columns.

**309. Reports → Margins.** Only margins below cost are coloured (red); everything else is plain.
