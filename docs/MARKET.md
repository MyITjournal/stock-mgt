# Market and go-to-market notes

Researched 2026-09-17, while the backend was being finished. Kept here rather than in a chat because it is the kind of thing that gets re-litigated every few months, and because the decisions it points to are due **after** the product is built, not now.

Treat the company details as a snapshot. This market moves fast — three of the names below changed status in under two years. **Re-check before acting on any of it.**

---

## 1. The FMCG inventory market (what stock-mgt is in)

### The serious incumbent is not a software subscription

**OmniRetail / OmniBiz** launched **OmniOne** in May 2026, a "commerce engine" for traditional FMCG trade in Nigeria: ordering, inventory visibility, and — the important part — **credit for distributors and retailers**. **TradeDepot** and **Moniepoint** operate in the same space.

**The thing to notice:** none of them sell inventory software for a monthly fee. They sit in the *flow of trade* and monetise distribution, payments and lending. The software is the hook, not the product. That is a repeated pattern here, not a coincidence.

### The cautionary tale is well documented

**Kippa** raised **$14.3M** from Target Global, Saison Capital and Goodwater Capital selling bookkeeping and payments to Nigerian small businesses. It shut its payments product in late 2023, quietly pivoted to edtech in 2024 without telling its users, and by August 2025 the founders had moved on and the site was down. Users were reportedly left unable to retrieve their own data.

That failure was **not** a product failure. It was an inability to make small-business software pay for itself at Nigerian price points. That is the risk this project carries, and no amount of good domain modelling removes it.

### What is genuinely unserved

The distribution platforms above optimise *buying from brands*. They do not do what this backend does well: **batch and expiry with FEFO, cost from exact invoice totals, free goods excluded from vendor quotas, credit that gates rather than caps, per-till cash-up**. Enterprise distributor software (RouteMagic, FieldAssist, 1Channel) covers that ground but is sold to manufacturers and priced accordingly.

**The gap is the mid-sized distributor** — too big for a notebook, too small for an enterprise DMS, and not served by a marketplace that wants to sell them goods rather than tools.

---

## 2. The preorder market (what the PRD is in)

### The mechanics are solved — inside Shopify

Shopify has a mature preorder app ecosystem: **Early Bird**, **Timesact**, **STOQ**, **Kaktus**, **Advanced PreOrder**, plus **HotWax Commerce** at the enterprise end doing exactly the hard part — releasing preorders against arriving inventory without overselling. Partial payments and deposits are standard across all of them.

**Every one of them requires a Shopify store.**

### The WhatsApp-first tools do something else

**OffaBuy**, **VendorDesk**, **Tracepos**, **VelvPay** and **WhatsOrder** all serve Nigerian WhatsApp vendors. They do order capture, payment tracking, receipts, checkout links and analytics. What none of them appear to do is the thing the PRD is built around:

> commit demand for goods that have not arrived → record what actually arrived →
> **allocate arrivals to preorders** → handle shortage, refund and uncollected outcomes →
> move only the surplus into shop stock

**That is the gap, and it is a real one.** The preorder-allocation problem is solved for people with storefronts and unsolved for people selling out of a WhatsApp status. The PRD's insistence on keeping committed demand and physical stock as separate facts is the correct instinct and is precisely what the order-tracker tools skip.

**Caveat before betting on it:** this was one search pass. Confirm by using two or three of those products properly, not by reading their landing pages — landing pages overclaim.

---

## 3. Price anchors

**Bumpa**, the closest comparable selling to Nigerian SMBs, as of September 2026:

| Plan | Price |
|---|---|
| Starter | ₦5,000/month |
| Pro | ₦10,000/month |
| Growth | ₦25,000/month |

Billed **quarterly, bi-annually or annually — not monthly**, after a 14-day free trial.

Two things follow. **₦5,000–25,000/month is the band**, so ARPU is thin and the unit economics only work at volume or with something else attached. And **forcing quarterly-minimum billing is a churn defence**: if monthly billing worked, they would offer it. Assume the same churn pressure.

---

## 4. What this implies

1. **The product is not the risk.** Distribution and willingness to pay are. Ten paying businesses will settle more than any further analysis.
2. **Subscription alone is the weak leg.** Every serious player monetises trade, payments or credit. The `inventory → payments → credit` thread already sketched (bank accounts, the statement parser, the loan app) is the same progression — it is a strategy, and worth being deliberate about rather than arriving at by accident.
3. **The preorder product may be the better wedge.** Sharper pain, an existing money flow, a clearer gap, and every preorder link a vendor shares puts the product in front of a customer. The FMCG backend is the deeper asset; the preorder app may be the faster door.
4. **Price against ₦5k–₦25k**, and expect to justify the top of it with something a notebook cannot do — expiry, credit control, multi-account reconciliation.

---

## 5. Go-to-market, for when the product is ready

### Channel comes before content

FMCG shop owners are not searching for inventory software. They are on WhatsApp, in trade associations, and they buy what the person at the next stall uses. The realistic channels:

- the design partner's own network — the first ten customers are almost certainly here
- WhatsApp groups and market associations
- **the brands whose vendor targets the product already models** — a manufacturer has a direct interest in its distributors being organised, and can introduce several at once
- field sales, which is expensive and is what the funded competitors spend their money on

The preorder product is different: those vendors are online, run drops, and already use tools. For that one, content and search are plausible, and it spreads through its own links.

### On being surfaced by AI assistants

A friend reported that SEO writing made Claude suggest his product, and credited 18 subscribers in a month to it. Worth separating what is true from what is not.

**True:** assistants with web search retrieve and cite pages. Clear, specific, retrievable content about a product can get it mentioned. People call this answer-engine or generative-engine optimisation.

**Not true:** there is no text you can write that *makes* a model recommend you. There is no ranking signal inside the model to target. What you control is whether good content exists when someone goes looking.

**Hold the attribution loosely.** The same content ranks in Google, gets shared, and reassures people checking whether you are real. Crediting one channel needs analytics, not a hunch — worth asking him what his actually showed.

**What works for both search and retrieval, in practice:**

- pages answering a specific question in the user's own words — "how to know which customer still owes me", "how to reconcile a bank statement against shop payments" — not feature lists
- presence where you can be quoted: your own docs, honest comparison pages, software directories,
  a real changelog
- third-party mentions, which count for more than anything on your own site

---

## 6. Where the preorder product fits

Assessed 2026-09-17 against `PRD-PREORDER-AND-SHOP.md`. The PRD is sound — its principles are real constraints rather than slogans, and several are the same discipline this backend already runs on. "Demand is not inventory" is "stock is an append-only ledger" wearing a different hat; "every important correction is auditable" is void-not-delete.

### One backend, two products

**Roughly 70% of the preorder product already exists here**: tenancy, auth, roles, customers, catalog, the inventory ledger, goods receipts, locations, idempotency, reports — and above all **payments with allocations**, which is structurally the same problem as allocating arrivals to preorders. One payment answering three invoices and twelve arriving units answering ten preorders are the same shape.

Genuinely new: drops, variants, interest-versus-preorder, allocation on arrival, pickup state, a public customer form, notifications. Call it 30%.

**So: the same codebase and deployment, a module enabled per organization, and two separate product surfaces.** Two landing pages, two names, two sales motions. An FMCG distributor never sees drops; a shoe vendor never sees FEFO or vendor purchase targets.

- *Not two codebases*: that means rebuilding auth, tenancy, payments and idempotency, then securing and deploying two systems on one person's time.
- *Not one merged product*: the buyers differ, and something aimed at both is compelling to neither.

### The finding that saves the most work

**Section 9 of the PRD — the integration contract — is its most expensive part, and choosing one backend deletes most of it.**

Product mapping, customer upsert, idempotent sync, retry handling, failure visibility, "must not create competing stock ledgers": that is weeks of work and a permanent bug source. It exists only because the PRD allows preorder to be a *separate system talking to* the shop backend.

On one backend, "connected mode" is not a protocol — it is the same database. Standalone versus connected becomes a flag on the organization (*does this org record goods receipts?*) rather than a synchronisation layer, and the principle "one inventory authority per location" enforces itself because there is only one ledger.

### One real model gap: a variant is not a unit

The PRD's terminology defines a variant as "size, colour, style, **or unit**". Those must stay separate, or an invariant this backend depends on breaks.

- A **unit** is a packaging multiple of the *same item* — 24 pieces make a carton. Stock is recorded in the base unit, and the whole ledger rests on that.
- A **variant** is a *different item* sharing a name — size 39 and size 41 are not multiples of each other.

They coexist: "Nike Air Max, size 39, sold in pairs" has both. The catalog today has units and no variants, so **variants are the one genuinely new piece of catalog modelling** the preorder work needs. Decide early whether a variant is its own `Product` under a shared group or a new `ProductVariant` — it touches every table that points at a product. Recorded in §15 of `DECISIONS.md` as well, since it lands in this codebase.

### Sequencing

Finish stock-mgt v1 (PDFs, then deploy), then build preorder on this backend, **then stop and sell**. The deployment work is shared — the preorder product would need it regardless.

**The risk worth naming**: four things are in flight — stock-mgt at ~90%, this PRD, the statement parser, the loan app. Every one is a decent idea. Building all four before any has a paying customer is the ordinary way good ideas die, and one developer's time is the binding constraint.

## 7. Re-check before launch

- Whether OmniOne has moved down-market into what this product does
- Whether any WhatsApp vendor tool has added preorder allocation (the whole wedge)
- Current Bumpa pricing and whether anyone has undercut it
- Whether Kippa's collapse left distrust worth addressing directly — *"your data is exportable and yours"* is a cheap and honest differentiator against a company that took users' records offline

---

## Sources

- [Kippa's unravelling after $14M](https://launchbaseafrica.com/2025/08/18/founders-exit-website-down-the-unraveling-of-target-global-backed-kippa-that-raised-over-14m/) ·
  [Kippa shuts payments](https://techcabal.com/2024/02/23/kippa-users-left-in-the-dark/)
- [OmniOne launch](https://techafricanews.com/2026/05/06/omnibiz-africa-launches-omnione-to-digitize-nigerias-fmcg-trade-network/) ·
  [OmniRetail](https://omniretail.africa/)
- [Bumpa pricing](https://www.getbumpa.com/pricing)
- [OffaBuy](https://offabuy.com/) · [VendorDesk](https://vendordesk.com.ng/) ·
  [Tracepos](https://blog.tracepos.net/how-to-track-whatsapp-orders/) · [WhatsOrder](https://whatsorder.com/)
- [HotWax preorder allocation](https://www.hotwax.co/solution/pre-orders/) ·
  [Shopify preorder apps](https://apps.shopify.com/categories/marketing-and-conversion-upsell-and-bundles-pre-orders)
- [FMCG distribution software (FEFO, van sales)](https://www.braincuber.com/fmcg-distribution-software)