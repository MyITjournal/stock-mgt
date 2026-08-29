/**
 * End-to-end smoke test for Slices 0-3, against a running server.
 *
 *   npm run start:dev        # terminal 1
 *   npm run smoke            # terminal 2
 *
 * Registration needs the OTP, which MailService logs instead of emailing
 * (Resend is unconfigured). The script pauses twice and asks for it; paste the
 * six digits from the "verification code=NNNNNN" line in the server log.
 *
 * Env: BASE_URL (default http://localhost:4000/api/v1)
 */
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { stdin, stdout } from 'node:process';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000/api/v1';
const rl = createInterface({ input: stdin, output: stdout });

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

let passed = 0;
const failures = [];
const NGN = (kobo) => `NGN ${(kobo / 100).toLocaleString('en-NG')}`;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ${GREEN}PASS${OFF} ${label}`);
  } else {
    failures.push(label);
    console.log(`  ${RED}FAIL${OFF} ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

function eq(label, actual, expected) {
  check(label, actual === expected, `expected ${expected}, got ${actual}`);
}

function step(n, title) {
  console.log(`\n${BOLD}${n}. ${title}${OFF}`);
}

/** Every call goes through here, so an unexpected status is never swallowed. */
async function api(method, path, { body, token, key, expect = [200, 201] } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  const wanted = Array.isArray(expect) ? expect : [expect];

  if (!wanted.includes(res.status)) {
    throw new Error(
      `${method} ${path} -> ${res.status} (wanted ${wanted.join('/')})\n` +
        `      ${JSON.stringify(data)}`,
    );
  }
  return { status: res.status, data };
}

/** Signs up a fresh owner and its organization, then verifies the OTP. */
async function signUp(label) {
  const email = `smoke+${Date.now()}${Math.floor(Math.random() * 100)}@example.com`;

  await api('POST', '/auth/register', {
    body: {
      email,
      password: 'correct-horse-battery',
      firstName: 'Smoke',
      lastName: 'Test',
      organizationName: label,
    },
  });

  console.log(`\n  Registered ${email} for "${label}".`);
  console.log('  Find the line "verification code=NNNNNN" in the server log.');
  const code = (await rl.question('  OTP: ')).trim();

  const { data } = await api('POST', '/auth/verify-otp', { body: { email, code } });
  return { email, token: data.accessToken };
}

/** One product at one location, in base units, with its batches. */
async function onHand(token, productId, locationId) {
  const { data } = await api(
    'GET',
    `/stock/levels?productId=${productId}&locationId=${locationId}&includeBatches=true`,
    { token },
  );
  return data[0] ?? { quantity: 0, batches: [] };
}

async function main() {
  console.log(`${BOLD}stock-mgt smoke test${OFF}  ->  ${BASE}`);

  // -- Slice 0: rails ------------------------------------------------------
  step(0, 'Rails: health check and the auth guard');
  const health = await api('GET', '/health');
  check('GET /health is public and reports the database', !!health.data);
  console.log(`      ${JSON.stringify(health.data)}`);
  await api('GET', '/products', { expect: 401 });
  check('an unauthenticated GET /products is 401', true);

  // -- Slice 1: tenancy and auth -------------------------------------------
  step(1, 'Auth: register -> OTP -> tokens');
  const org = await signUp('Adebayo Stores');
  const t = org.token;
  check('verify-otp returned an access token', typeof t === 'string' && t.length > 20);

  const me = await api('GET', '/auth/me', { token: t });
  check('/auth/me resolves the user and the active organization', !!me.data);
  console.log(`      ${JSON.stringify(me.data).slice(0, 200)}`);

  // -- Slice 2: catalog ----------------------------------------------------
  step(2, 'Catalog: the seeded defaults, then a category, a tier and a product');
  // Registration seeds what a business needs before its catalog is usable: a
  // default price tier for prices to hang off, and the packaging vocabulary.
  const seededTypes = (await api('GET', '/packaging-types', { token: t })).data;
  const seededTiers = (await api('GET', '/price-tiers', { token: t })).data;
  // DEFAULT_PACKAGING_TYPES in packaging-type.service.ts: piece..keg.
  eq('a new org is seeded with the packaging vocabulary', seededTypes.length, 14);
  check(
    'ordered for shelf pickers, piece first and keg last',
    seededTypes.at(0)?.name === 'piece' && seededTypes.at(-1)?.name === 'keg',
    seededTypes.map((p) => p.name).join(', '),
  );
  eq('and exactly one price tier', seededTiers.length, 1);
  eq('which is Retail, and is the default', seededTiers[0].name, 'Retail');
  eq('Retail is flagged default', seededTiers[0].isDefault, true);

  const packaging = seededTypes.find((p) => p.name === 'tin');
  check('"tin" is one of the seeded packaging types', !!packaging);

  const category = (await api('POST', '/categories', { token: t, body: { name: 'Beverages' } })).data;
  const tier = (await api('POST', '/price-tiers', { token: t, body: { name: 'Wholesale' } })).data;
  check('a category and a second tier created', !!category.id && !!tier.id);

  const product = (
    await api('POST', '/products', {
      token: t,
      body: {
        name: 'Peak Milk 400g',
        categoryId: category.id,
        packagingTypeId: packaging.id,
        basePrice: 250_000, // NGN 2,500 a tin, tax-inclusive
        taxRateBps: 750,
        units: [
          { name: 'piece', factor: 1, isDefaultSelling: true },
          { name: 'carton', factor: 24 },
        ],
      },
    })
  ).data;
  const piece = product.units.find((u) => u.factor === 1);
  const carton = product.units.find((u) => u.factor === 24);
  check('product created with a base unit and a carton', !!piece && !!carton);
  check('SKU generated from the name', !!product.sku, JSON.stringify(product.sku));

  // Invariant: exactly one unit with factor 1.
  await api('POST', '/products', {
    token: t,
    expect: 400,
    body: {
      name: 'Two Bases',
      basePrice: 1000,
      units: [
        { name: 'piece', factor: 1 },
        { name: 'unit', factor: 1 },
      ],
    },
  });
  check('a product with two factor-1 units is rejected (400)', true);

  step(3, 'Money: VAT derived by subtraction, never stored');
  const withTax = (await api('GET', `/products/${product.id}`, { token: t })).data;
  const { gross, net, tax } = withTax.tax;
  eq('gross is the stored tax-inclusive price', gross, 250_000);
  eq('net = round(gross / 1.075)', net, 232_558);
  eq('net + tax === gross exactly', net + tax, gross);
  console.log(`      ${NGN(gross)} = ${NGN(net)} + ${NGN(tax)} VAT`);

  step(4, 'Pricing: a tier price beats the scaled base price');
  const fallback = (
    await api('GET', `/products/${product.id}/price?unitId=${carton.id}`, { token: t })
  ).data;
  eq('no tier price yet -> basePrice x 24', fallback.price, 250_000 * 24);
  eq('and isTierPrice is false', fallback.isTierPrice, false);

  await api('POST', `/products/${product.id}/prices`, {
    token: t,
    body: { tierId: tier.id, unitId: carton.id, price: 5_400_000 },
  });
  const tiered = (
    await api('GET', `/products/${product.id}/price?unitId=${carton.id}&tierId=${tier.id}`, {
      token: t,
    })
  ).data;
  eq('the wholesale carton price is used', tiered.price, 5_400_000);
  check(
    'and it is cheaper per piece than the base price',
    tiered.price / 24 < 250_000,
    `${NGN(tiered.price / 24)} vs ${NGN(250_000)}`,
  );

  step(5, 'Barcodes: a generated internal code, and a scan worth 24 pieces');
  const generated = (
    await api('POST', `/products/${product.id}/barcodes`, {
      token: t,
      body: { unitId: carton.id, isPrimary: true },
    })
  ).data;
  check('a carton with no code gets an internal EAN-13', /^\d{13}$/.test(generated.code), generated.code);

  await api('POST', `/products/${product.id}/barcodes`, {
    token: t,
    expect: 400,
    body: { unitId: piece.id, code: '5449000000997' }, // real code ends 996
  });
  check('an EAN-13 with a wrong check digit is rejected (400)', true);

  const scan = (await api('GET', `/scan/${generated.code}`, { token: t })).data;
  eq('scanning the carton code resolves to the carton unit', scan.unit.id, carton.id);
  eq('one scan means 24 base units', scan.baseQuantity, 24);

  step(6, 'Idempotency: a retried write does not create a second row');
  const key = randomUUID();
  const body = {
    name: 'Milo 400g Pouch',
    basePrice: 180_000,
    units: [{ name: 'piece', factor: 1 }],
  };
  const first = await api('POST', '/products', { token: t, body, key });
  const replay = await api('POST', '/products', { token: t, body, key });
  eq('the replay returns the original id', replay.data.id, first.data.id);
  const milos = (await api('GET', '/products?search=Milo', { token: t })).data;
  eq('and only one Milo exists', milos.length, 1);

  await api('POST', '/products', {
    token: t,
    key,
    expect: 409,
    body: { ...body, name: 'Something Else' },
  });
  check('the same key with a different body is 409', true);

  // -- Slice 3: the ledger -------------------------------------------------
  step(7, 'Locations and supplier');
  // Stock has to land somewhere, so registration already made one location. A
  // business with a single shop never has to touch this screen.
  const seededLocations = (await api('GET', '/locations', { token: t })).data;
  eq('a new org already has one location', seededLocations.length, 1);
  const main = seededLocations[0];
  eq('it is Main Store', main.name, 'Main Store');
  eq('and it is the default', main.isDefault, true);

  await api('POST', '/locations', {
    token: t,
    expect: 409,
    body: { name: 'Main Store' },
  });
  check('a second location with the same name is 409', true);

  const van = (
    await api('POST', '/locations', { token: t, body: { name: "Ibrahim's Van", sortOrder: 20 } })
  ).data;
  const supplier = (
    await api('POST', '/suppliers', {
      token: t,
      body: { name: 'Unilever Nigeria', phone: '+2348012345678' },
    })
  ).data;
  check('the van and a supplier created', !!van.id && !!supplier.id);
  eq('the van did not steal the default flag', van.isDefault, false);

  step(8, 'Receiving: invoice totals in, unit cost out');
  // 10 cartons arrive, the invoice charges for 9. The two free cartons pull the
  // cost of every unit down: 240 tins for NGN 90,000 is NGN 375.00 each.
  const r1 = (
    await api('POST', '/goods-receipts', {
      token: t,
      key: randomUUID(),
      body: {
        supplierId: supplier.id,
        locationId: main.id,
        invoiceNumber: 'INV-88213',
        lines: [
          {
            productId: product.id,
            unitId: carton.id,
            quantityReceived: 10,
            quantityPaidFor: 9,
            totalCost: 9_000_000,
            lotCode: 'LOT-A',
            expiryDate: '2027-06-30T00:00:00.000Z',
          },
        ],
      },
    })
  ).data;
  const l1 = r1.lines[0];
  eq('10 cartons became 240 base units', l1.quantityReceived, 240);
  eq('quantityPaidFor is kept separately', l1.quantityPaidFor, 216);
  eq('the exact invoice total is what is stored', l1.totalCost, 9_000_000);
  eq('unit cost is the ratio, computed on read', l1.unitCost, 37_500);
  console.log(`      NGN 90,000 / 240 tins = ${NGN(l1.unitCost)} each, free goods included`);

  // A second delivery: dearer, and expiring sooner. This is the FEFO bait.
  const r2 = (
    await api('POST', '/goods-receipts', {
      token: t,
      key: randomUUID(),
      body: {
        supplierId: supplier.id,
        locationId: main.id,
        invoiceNumber: 'INV-88400',
        lines: [
          {
            productId: product.id,
            unitId: carton.id,
            quantityReceived: 5,
            totalCost: 4_800_000,
            lotCode: 'LOT-B',
            expiryDate: '2026-12-31T00:00:00.000Z',
          },
        ],
      },
    })
  ).data;
  eq('the second delivery costs more per tin', r2.lines[0].unitCost, 40_000);

  step(9, 'Stock levels and expiry');
  let level = await onHand(t, product.id, main.id);
  eq('360 base units on hand at Main Store', level.quantity, 360);
  eq('held as two separate batches', level.batches.length, 2);
  check(
    'each batch keeps its own cost rather than an averaged one',
    new Set(level.batches.map((b) => b.unitCost)).size === 2,
    JSON.stringify(level.batches.map((b) => b.unitCost)),
  );

  const expiring = (
    await api('GET', '/stock/batches?expiringBefore=2027-01-01T00:00:00.000Z', { token: t })
  ).data;
  eq('only one batch expires before 2027', expiring.length, 1);
  eq('and it is LOT-B', expiring[0].lotCode, 'LOT-B');

  step(10, 'FEFO: the write-off takes the batch that expires first');
  await api('POST', '/stock/adjustments', {
    token: t,
    key: randomUUID(),
    body: {
      productId: product.id,
      locationId: main.id,
      unitId: carton.id,
      quantity: -1,
      reason: 'damage',
      note: 'Crate dropped at the back door.',
    },
  });
  level = await onHand(t, product.id, main.id);
  eq('336 left at Main Store', level.quantity, 336);
  const lotA = level.batches.find((b) => b.lotCode === 'LOT-A');
  const lotB = level.batches.find((b) => b.lotCode === 'LOT-B');
  eq('LOT-A, the later expiry, is untouched', lotA.quantity, 240);
  eq('LOT-B, the sooner expiry, took the hit', lotB.quantity, 96);

  step(11, 'Transfer: batch identity survives the move');
  const transferKey = randomUUID();
  const transferBody = {
    productId: product.id,
    fromLocationId: main.id,
    toLocationId: van.id,
    unitId: carton.id,
    quantity: 2,
    note: "Loading Ibrahim's van for the Tuesday route.",
  };
  const transfer = (
    await api('POST', '/stock/transfers', { token: t, key: transferKey, body: transferBody })
  ).data;
  check('the pair shares a transferGroupId', !!transfer.transferGroupId);
  eq('one movement out', transfer.out.length, 1);
  eq('one movement in', transfer.in.length, 1);
  eq('the outbound leg is negative', Math.sign(transfer.out[0].quantity), -1);
  eq('the inbound leg is positive', Math.sign(transfer.in[0].quantity), 1);
  eq('both legs name the same batch', transfer.in[0].batchId, transfer.out[0].batchId);

  const vanLevel = await onHand(t, product.id, van.id);
  eq('48 base units reached the van', vanLevel.quantity, 48);
  eq('and they are still LOT-B, with its expiry', vanLevel.batches[0].lotCode, 'LOT-B');
  level = await onHand(t, product.id, main.id);
  eq('288 left at Main Store', level.quantity, 288);

  await api('POST', '/stock/transfers', { token: t, key: transferKey, body: transferBody });
  eq(
    'replaying the transfer does not move it twice',
    (await onHand(t, product.id, van.id)).quantity,
    48,
  );

  step(12, 'Negative stock: refused by default, forced only with a reason');
  await api('POST', '/stock/adjustments', {
    token: t,
    expect: 409,
    body: {
      productId: product.id,
      locationId: main.id,
      unitId: carton.id,
      quantity: -1000,
      reason: 'count_correction',
    },
  });
  check('an outbound larger than stock is 409', true);
  eq('and nothing was written', (await onHand(t, product.id, main.id)).quantity, 288);

  await api('POST', '/stock/adjustments', {
    token: t,
    expect: 409,
    body: {
      productId: product.id,
      locationId: van.id,
      unitId: carton.id,
      quantity: -3,
      reason: 'count_correction',
      force: true,
    },
  });
  check('force without a reason is refused', true);

  await api('POST', '/stock/adjustments', {
    token: t,
    key: randomUUID(),
    body: {
      productId: product.id,
      locationId: van.id,
      unitId: carton.id,
      quantity: -3,
      reason: 'count_correction',
      force: true,
      forcedReason: 'Sold from the van before the delivery was entered.',
    },
  });
  eq(
    'the owner forced it through and the van is short 24',
    (await onHand(t, product.id, van.id)).quantity,
    -24,
  );

  const forced = (await api('GET', '/stock/forced', { token: t })).data;
  check('the override left an audit trail', forced.length > 0, `${forced.length} rows`);
  check('with the reason attached', !!forced[0].forcedReason, JSON.stringify(forced[0].forcedReason));
  check('and the name of whoever recorded it', !!forced[0].recordedBy);

  step(13, 'Delta sync: keyset paging over the ledger');
  // The window stops a second short of now, so a movement written this instant
  // is deliberately withheld until it can no longer be raced by a commit.
  await new Promise((r) => setTimeout(r, 1500));

  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = (
      await api(
        'GET',
        `/stock/movements?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { token: t },
      )
    ).data;
    seen.push(...page.movements);
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 20);

  eq('every movement came back across the pages', seen.length, 7);
  check('and it actually paged', pages > 1, `${pages} pages`);
  eq('no id was returned twice', new Set(seen.map((m) => m.id)).size, seen.length);
  check('every movement carries a batch', seen.every((m) => !!m.batchId));
  eq(
    'the ledger sums to what the levels say',
    seen.reduce((sum, m) => sum + m.quantity, 0),
    288 - 24,
  );

  await api('GET', '/stock/movements?cursor=not-a-cursor', { token: t, expect: 400 });
  check('a malformed cursor is 400, not a silent full resync', true);

  step(14, 'The balance cache can be rebuilt from the ledger');
  const rebuild = (await api('POST', '/stock/rebuild-balances', { token: t })).data;
  eq('cache and ledger agree, nothing to correct', rebuild.corrected, 0);

  step(15, 'Tenancy: a second organization sees none of this');
  const other = await signUp('Chidi Provisions');
  eq(
    'no products leak across the tenant boundary',
    (await api('GET', '/products', { token: other.token })).data.length,
    0,
  );
  eq('and no stock', (await api('GET', '/stock/levels', { token: other.token })).data.length, 0);

  // It sees its own seeded defaults and none of the first org's rows: one
  // Main Store of its own, with a different id.
  const theirLocations = (await api('GET', '/locations', { token: other.token })).data;
  eq('it has its own seeded Main Store, and only that', theirLocations.length, 1);
  check('which is a different row from the first org\'s', theirLocations[0].id !== main.id);
  eq(
    'it does not see the first org\'s van',
    theirLocations.filter((l) => l.name === "Ibrahim's Van").length,
    0,
  );
  eq(
    'and its own tier, not the Wholesale one',
    (await api('GET', '/price-tiers', { token: other.token })).data.length,
    1,
  );
  await api('GET', `/products/${product.id}`, { token: other.token, expect: 404 });
  check("fetching the other org's product by id is 404", true);

  const verdict = failures.length ? `${RED}FAILED` : `${GREEN}PASSED`;
  console.log(`\n${BOLD}${verdict}${OFF}  ${passed} checks passed, ${failures.length} failed.`);
  for (const f of failures) console.log(`  - ${f}`);
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`\n${RED}Aborted:${OFF} ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
