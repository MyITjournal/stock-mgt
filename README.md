# stock-mgt

Sales and inventory for FMCG businesses in Nigeria, sold as a subscription.

A shop owner can ring up a sale at the counter, take a payment, record a delivery from a vendor,
see what is on the shelf and what it is worth, chase who owes money, and read whether the month
made a profit. It is deliberately **not accounting**: no chart of accounts, no double-entry,
no journals. Management figures a shopkeeper will act on.

Two applications in one repository:

| | | |
|---|---|---|
| **API** | `src/` | NestJS + Prisma + PostgreSQL, REST under `/api/v1` |
| **Dashboard** | `web/` | Vite + React + TypeScript, its own `package.json` |

They share no code. The dashboard talks to the API over HTTP and types itself from the API's
OpenAPI document.

## Running it

You need Node 22 (what it is developed against — nothing pins it) and a PostgreSQL database.

```bash
npm install
cp .env.example .env          # then set DATABASE_URL and the three JWT secrets
npm run db:deploy             # apply migrations
```

Then **two servers, in two terminals**:

```bash
npm run start:dev             # the API, on 4000
```

```bash
cd web
npm install
npm run dev                   # the dashboard, on 5173
```

Open **http://localhost:5173**. That is the application.

Port 4000 is the API alone. `npm run start:prod` runs the built API and **does not serve the
dashboard**, so it is not a shortcut to seeing the app.

Swagger is at `http://localhost:4000/docs` when `SWAGGER_ENABLED=true` — which `.env.example`
sets, though the code defaults it to **off** so that a production instance does not publish its
own API surface by accident. Note that Swagger sits outside `API_PREFIX`: the routes it documents
are under `/api/v1`, but the page itself is not.

There is no seed script. Register through the dashboard's sign-in screen; the verification code
is written to the server log rather than emailed until `RESEND_API_KEY` is set.

## Checks

```bash
npm run typecheck
npm run lint
npx jest                      # 457 unit tests
npm run build
npm run smoke                 # end-to-end, against a running server
```

`npm run smoke` is the one that matters. It walks the whole API against a live server in about
40 steps, and its load-bearing assertion is that **the sum of every stock movement equals the sum
of the stock levels** — a sale that deducts wrongly breaks that and nothing else does. It needs
the sign-up code, which it will prompt for, or read from the log:

```bash
npm run start:dev > server.log 2>&1        # terminal 1
SMOKE_SERVER_LOG=server.log npm run smoke  # terminal 2
```

Run it twice inside a minute and the second run fails with a 429 on login. That is the rate
limiter working; wait a minute.

The `web/` tree has its own `npm run typecheck`, `npm run lint` and `npm run build`. The root
configs are scoped to `src` and `test` so the two cannot break each other.

## Where the thinking is written down

Most of what is surprising about this codebase is deliberate, and the reasoning is expensive to
reconstruct from the code.

- **[docs/DECISIONS.md](docs/DECISIONS.md)** — every architecture decision, what was rejected and
  why, and the traps already hit. Read it before changing anything structural.
- **[CLAUDE.md](CLAUDE.md)** — the working brief: current state, the invariants, and the rules a
  change has to respect.
- **[docs/MANUAL-TESTS.md](docs/MANUAL-TESTS.md)** — the by-hand walkthrough, and what clicking
  finds that the smoke suite does not.
- **[docs/MARKET.md](docs/MARKET.md)** — who this is for and what constrains it.
- **[docs/PRD-V2.md](docs/PRD-V2.md)** — what comes after v1, and the gates between.

### The four invariants

Breaking one of these is a data-integrity bug rather than a style choice. They are stated in full
in CLAUDE.md; in short:

1. **Money is an integer count of kobo.** Never a float. Prices are stored tax-inclusive and VAT
   is derived by subtraction.
2. **Cost is stored as exact invoice totals, never a rounded per-unit average.** Unit cost is a
   ratio, computed on read.
3. **Stock is an append-only ledger**, recorded in base units — never a mutable quantity column.
   A mistake is corrected by another movement.
4. **Every tenant-owned table carries `organizationId`** and is registered in
   `TENANT_SCOPED_MODELS`. A test derives the expected list from the Prisma schema and fails
   until it is.

## Status

The backend and the dashboard are both feature-complete. What remains before it ships is the
deploy, planned in DECISIONS.md §15.

Nothing in the dashboard has been verified in a browser by an automated check — there is no
Playwright here — so the wiring, the arithmetic and the refusals are tested and the rendering is
not. The first pass of real use found eleven bugs, two of which made whole screens unusable while
every check in the repository stayed green; they are written up in DECISIONS.md §18. Testing by
hand is still the real gate.

## Licence

Proprietary. All rights reserved — this is a commercial product, not open source.
