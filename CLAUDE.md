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

## Working practice

- `main` (release, tagged) → `dev` (integration) → short-lived feature branches merged `--no-ff`.
  Never commit to `main`.
- Plan → get approval → build, one slice at a time.
- A branch is done when `npm run typecheck`, `npm run lint`, `npx jest` and `npm run build` are
  all clean **and** the behaviour is verified against a running server.

## Commands

```bash
npm run start:dev     # watch mode; Swagger at http://localhost:4000/docs
npm run typecheck
npm run lint
npx jest
npm run build
npm run db:studio
```

Migrations: `prisma migrate dev` is interactive and fails in a non-interactive shell. Use
`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
into a new folder under `prisma/migrations/`, then `npx prisma migrate deploy`.
