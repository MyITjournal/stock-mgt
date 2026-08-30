/**
 * End-to-end smoke test for slices 0-5, against a running server.
 *
 *   npm run start:dev        # terminal 1
 *   npm run smoke            # terminal 2
 *
 * Registration needs the OTP, which MailService logs instead of emailing
 * (Resend is unconfigured). The script pauses twice and asks for it; paste the
 * six digits from the "verification code=NNNNNN" line in the server log.
 *
 * To run it unattended, send the server's output to a file and point
 * SMOKE_SERVER_LOG at it — the code is then read from the log instead:
 *
 *   npm run start:dev > server.log 2>&1
 *   SMOKE_SERVER_LOG=server.log npm run smoke
 *
 * Env: BASE_URL (default http://localhost:4000/api/v1), SMOKE_SERVER_LOG.
 */
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000/api/v1';
const SERVER_LOG = process.env.SMOKE_SERVER_LOG;
const rl = SERVER_LOG ? null : createInterface({ input: stdin, output: stdout });

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

/** How many codes the log had already produced before the current signup. */
let otpsSeen = 0;

/**
 * The verification code, either typed in or picked out of the server log.
 *
 * Reading it from the log is what lets this run unattended. The count of codes
 * already seen is tracked so the second registration waits for a code that is
 * genuinely new rather than replaying the first one.
 */
async function readOtp() {
  if (!SERVER_LOG) {
    console.log('  Find the line "verification code=NNNNNN" in the server log.');
    return (await rl.question('  OTP: ')).trim();
  }

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const log = await readFile(SERVER_LOG, 'utf8').catch(() => '');
    const codes = [...log.matchAll(/verification code=(\d{6})/g)].map((m) => m[1]);

    if (codes.length > otpsSeen) {
      otpsSeen = codes.length;
      const code = codes.at(-1);
      console.log(`  OTP from ${SERVER_LOG}: ${code}`);
      return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(`No new verification code appeared in ${SERVER_LOG}`);
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
  const code = await readOtp();

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

/** Just the base-unit count, for the places that only need the number. */
async function levelAt(token, productId, locationId) {
  return (await onHand(token, productId, locationId)).quantity;
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

  // -- Slice 4: selling ----------------------------------------------------
  step(13, 'A credit sale on the wholesale tier, picked across two lots');
  const shopkeeper = (
    await api('POST', '/customers', {
      token: t,
      body: { firstName: 'Chidi', lastName: 'Okeke', phone: '+2348022222222' },
    })
  ).data;
  eq('a new customer has no tier of their own', shopkeeper.priceTierId, null);

  const moved = (
    await api('PATCH', `/customers/${shopkeeper.id}`, {
      token: t,
      body: { priceTierId: tier.id },
    })
  ).data;
  eq('and can be moved onto the wholesale list', moved.priceTierId, tier.id);

  // Main Store holds LOT-B (48, expires sooner) and LOT-A (240). Three cartons
  // is 72 pieces, so the pick must empty LOT-B and take the rest from LOT-A.
  const credit = (
    await api('POST', '/sales', {
      token: t,
      key: randomUUID(),
      body: {
        customerId: shopkeeper.id,
        locationId: main.id,
        payment: { amount: 0 },
        note: 'Goes out on the Tuesday route.',
        lines: [{ productId: product.id, unitId: carton.id, quantity: 3 }],
      },
    })
  ).data;

  eq('the first invoice is numbered INV-0001', credit.number, 'INV-0001');
  eq('priced on the wholesale carton price', credit.total, 3 * 5_400_000);
  eq('the tier it was priced on is recorded', credit.tier.id, tier.id);
  eq('VAT is derived and frozen onto the sale', credit.taxTotal, credit.total - Math.round(credit.total / 1.075));
  eq('nothing was paid, so the whole total is owed', credit.balance, credit.total);
  // 48 pieces from LOT-B at NGN 400.00, then 24 from LOT-A at NGN 375.00.
  eq('cost of goods sold spans both lots', credit.costTotal, 48 * 40_000 + 24 * 37_500);
  eq('and it is rounded to whole kobo', Number.isInteger(credit.costTotal), true);

  level = await onHand(t, product.id, main.id);
  eq('stock actually left the shelf', level.quantity, 216);
  eq('the short-dated lot is empty, so only one batch is left', level.batches.length, 1);
  eq('and it is LOT-A', level.batches[0].lotCode, 'LOT-A');

  step(14, 'A walk-in paying cash, at the default tier');
  const cash = (
    await api('POST', '/sales', {
      token: t,
      key: randomUUID(),
      body: {
        locationId: main.id,
        lines: [{ productId: product.id, unitId: carton.id, quantity: 2 }],
      },
    })
  ).data;

  eq('the counter gets the next number', cash.number, 'INV-0002');
  eq('no customer is invented for a stranger', cash.customerId, null);
  // Retail has no carton price, so it falls back to basePrice x 24.
  eq('priced at the base price scaled by the unit', cash.total, 2 * 250_000 * 24);
  eq('a counter sale is paid in full by default', cash.allocated, cash.total);
  eq('so nothing is owed', cash.balance, 0);
  eq('cost comes from LOT-A alone', cash.costTotal, 48 * 37_500);
  eq('168 left at Main Store', (await onHand(t, product.id, main.id)).quantity, 168);

  step(15, 'A negotiated price, and something that is not stocked');
  const service = (
    await api('POST', '/products', {
      token: t,
      body: {
        name: 'Delivery to Ikeja',
        basePrice: 500_000,
        trackStock: false,
        units: [{ name: 'trip', factor: 1 }],
      },
    })
  ).data;

  // The ledger holds its window a second short of now, so both counts have to
  // wait for their side of the sale to become visible.
  const countMovements = async () => {
    await new Promise((r) => setTimeout(r, 1500));
    return (await api('GET', '/stock/movements?limit=1000', { token: t })).data
      .movements.length;
  };
  const movementsBefore = await countMovements();

  const mixed = (
    await api('POST', '/sales', {
      token: t,
      key: randomUUID(),
      body: {
        locationId: main.id,
        lines: [
          // The price agreed on the phone, not the one on the list.
          { productId: product.id, unitId: piece.id, quantity: 10, unitPrice: 230_000 },
          { productId: service.id, quantity: 1 },
        ],
      },
    })
  ).data;

  const soldPiece = mixed.lines.find((l) => l.productId === product.id);
  const soldService = mixed.lines.find((l) => l.productId === service.id);
  eq('the agreed price is what was charged', soldPiece.unitPrice, 230_000);
  eq('not the list price', soldPiece.lineTotal, 2_300_000);
  eq('a service is sold and taxed like anything else', soldService.lineTotal, 500_000);
  eq('but has no cost of goods', soldService.costOfGoodsSold, 0);
  eq('the sale totals both lines', mixed.total, 2_300_000 + 500_000);

  const movementsAfter = await countMovements();
  eq('only the stocked line reached the ledger', movementsAfter - movementsBefore, 1);
  eq('158 left at Main Store', (await onHand(t, product.id, main.id)).quantity, 158);

  step(16, 'Selling stock that is not there');
  await api('POST', '/sales', {
    token: t,
    expect: 409,
    body: {
      locationId: main.id,
      lines: [{ productId: product.id, unitId: carton.id, quantity: 100 }],
    },
  });
  check('a sale larger than stock is 409', true);
  eq('and no stock moved', (await onHand(t, product.id, main.id)).quantity, 158);

  const forcedSale = (
    await api('POST', '/sales', {
      token: t,
      key: randomUUID(),
      body: {
        locationId: van.id,
        force: true,
        forcedReason: 'Rep sold it off the van this morning.',
        lines: [{ productId: product.id, unitId: carton.id, quantity: 1 }],
      },
    })
  ).data;
  check('an owner can force it through', !!forcedSale.id);
  eq('the van goes further short', (await onHand(t, product.id, van.id)).quantity, -48);

  const forcedNow = (await api('GET', '/stock/forced', { token: t })).data;
  check(
    'and the forced sale joins the audit trail',
    forcedNow.some((m) => m.type === 'sale'),
    forcedNow.map((m) => m.type).join(', '),
  );

  step(17, 'Taking goods back');
  const returned = (
    await api('POST', `/sales/${cash.id}/returns`, {
      token: t,
      key: randomUUID(),
      body: {
        lines: [{ saleLineId: cash.lines[0].id, unitId: carton.id, quantity: 1 }],
      },
    })
  ).data;

  eq('one carton came back', returned.returns.length, 1);
  eq('refunded half of what that line was charged', returned.refunded, cash.total / 2);
  eq('so the shop now owes the customer', returned.balance, -(cash.total / 2));
  eq(
    'and the stock went back to the lot it came from',
    (await onHand(t, product.id, main.id)).batches.find((b) => b.lotCode === 'LOT-A')
      .quantity,
    182,
  );

  await api('POST', `/sales/${cash.id}/returns`, {
    token: t,
    expect: 409,
    body: { lines: [{ saleLineId: cash.lines[0].id, unitId: carton.id, quantity: 2 }] },
  });
  check('taking back more than was sold is 409', true);

  step(18, 'Sales list, paged the same way the ledger is');
  await new Promise((r) => setTimeout(r, 1500));
  const invoices = [];
  let saleCursor = null;
  let salePages = 0;
  do {
    const page = (
      await api(
        'GET',
        `/sales?limit=2${saleCursor ? `&cursor=${encodeURIComponent(saleCursor)}` : ''}`,
        { token: t },
      )
    ).data;
    invoices.push(...page.sales);
    saleCursor = page.nextCursor;
    salePages += 1;
  } while (saleCursor && salePages < 20);

  eq('every sale came back', invoices.length, 4);
  eq('no id twice', new Set(invoices.map((s) => s.id)).size, invoices.length);
  eq(
    'invoice numbers run in sequence with no gaps',
    invoices.map((s) => s.number).sort().join(','),
    'INV-0001,INV-0002,INV-0003,INV-0004',
  );
  eq(
    'filtering by customer finds the credit sale',
    (await api('GET', `/sales?customerId=${shopkeeper.id}`, { token: t })).data.sales
      .length,
    1,
  );

  step(19, 'Delta sync: keyset paging over the ledger');
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

  eq('every movement came back across the pages', seen.length, 13);
  check('and it actually paged', pages > 1, `${pages} pages`);
  eq('no id was returned twice', new Set(seen.map((m) => m.id)).size, seen.length);
  check('every movement carries a batch', seen.every((m) => !!m.batchId));
  check(
    'selling wrote sale movements, and the return wrote one back',
    seen.filter((m) => m.type === 'sale').length === 5 &&
      seen.filter((m) => m.type === 'return_in').length === 1,
    seen.map((m) => m.type).join(', '),
  );

  // The check that catches a sale deducting wrongly: the ledger is the truth,
  // the levels are a cache of it, and the two must agree to the unit.
  const levels = (await api('GET', '/stock/levels?includeEmpty=true', { token: t })).data;
  const ledgerSum = seen.reduce((sum, m) => sum + m.quantity, 0);
  eq(
    'the ledger sums to what the levels say',
    ledgerSum,
    levels.reduce((sum, row) => sum + row.quantity, 0),
  );
  eq('182 left at Main Store after everything', await levelAt(t, product.id, main.id), 182);
  eq('and the van is 48 short', await levelAt(t, product.id, van.id), -48);
  eq('which is what the ledger adds up to', ledgerSum, 134);

  await api('GET', '/stock/movements?cursor=not-a-cursor', { token: t, expect: 400 });
  check('a malformed cursor is 400, not a silent full resync', true);

  step(20, 'The balance cache can be rebuilt from the ledger');
  const rebuild = (await api('POST', '/stock/rebuild-balances', { token: t })).data;
  eq('cache and ledger agree, nothing to correct', rebuild.corrected, 0);

  // -- Slice 5: money in ---------------------------------------------------
  step(21, 'Receivables: who owes me, longest outstanding first');
  const owed = (await api('GET', '/receivables', { token: t })).data;

  eq('only invoices with money on them are listed', owed.invoices.length, 2);
  eq('the credit sale is the one actually owed', owed.totalOutstanding, credit.total);
  check(
    'and the oldest is first',
    owed.invoices[0].number === 'INV-0001',
    owed.invoices.map((i) => i.number).join(', '),
  );
  // The returned walk-in sale is money owed *back*, so it is listed but never
  // netted off what customers owe the business.
  const walkIn = owed.invoices.find((i) => i.number === 'INV-0002');
  eq('a sale returned after payment shows as money owed back', walkIn.balance, -(cash.total / 2));
  eq('the customer totals split walk-ins from the account', owed.byCustomer.length, 2);
  eq(
    'the shopkeeper bucket carries the whole invoice',
    owed.byCustomer.find((c) => c.customer?.id === shopkeeper.id).balance,
    credit.total,
  );

  step(22, 'A part payment settles the oldest invoice');
  const partKey = randomUUID();
  const part = (
    await api('POST', '/payments', {
      token: t,
      key: partKey,
      body: {
        customerId: shopkeeper.id,
        amount: 6_200_000,
        method: 'transfer',
        reference: 'FT26083012345',
        note: 'Part payment, balance on Friday.',
      },
    })
  ).data;

  eq('nobody said which invoice, so it went to the oldest', part.allocations.length, 1);
  eq('and that is INV-0001', part.allocations[0].sale.number, 'INV-0001');
  eq('all of it was claimed', part.allocated, 6_200_000);
  eq('so none of it is sitting as credit', part.unallocated, 0);
  eq('the method survives for the bank reconciliation', part.method, 'transfer');

  let owing = (await api('GET', `/sales/${credit.id}`, { token: t })).data;
  eq('the invoice records what was paid against it', owing.allocated, 6_200_000);
  eq('and owes the rest', owing.balance, credit.total - 6_200_000);

  // Byte-identical to the first attempt: the interceptor fingerprints the
  // body, so a retry that quietly changed something is a different request.
  const rebanked = (
    await api('POST', '/payments', {
      token: t,
      key: partKey,
      body: {
        customerId: shopkeeper.id,
        amount: 6_200_000,
        method: 'transfer',
        reference: 'FT26083012345',
        note: 'Part payment, balance on Friday.',
      },
    })
  ).data;
  eq('a retried payment returns the original row', rebanked.id, part.id);
  eq(
    'and the money is not banked twice',
    (await api('GET', `/sales/${credit.id}`, { token: t })).data.balance,
    credit.total - 6_200_000,
  );

  step(23, 'Overpaying an invoice is refused; change becomes credit');
  await api('POST', '/payments', {
    token: t,
    expect: 409,
    body: {
      customerId: shopkeeper.id,
      amount: 99_999_999,
      allocations: [{ saleId: credit.id, amount: 99_999_999 }],
    },
  });
  check('allocating more than an invoice owes is 409', true);

  // Pays the invoice off and hands over more than was due. The excess is not
  // forced onto the invoice; it stays on the customer for the next one.
  const settled = (
    await api('POST', '/payments', {
      token: t,
      key: randomUUID(),
      body: { customerId: shopkeeper.id, amount: 12_000_000, method: 'cash' },
    })
  ).data;

  eq('what was owed came off the invoice', settled.allocated, credit.total - 6_200_000);
  eq('and the rest is credit, not an overpaid invoice', settled.unallocated, 2_000_000);

  owing = (await api('GET', `/sales/${credit.id}`, { token: t })).data;
  eq('the invoice is settled exactly', owing.balance, 0);

  const statement = (
    await api('GET', `/customers/${shopkeeper.id}/statement`, { token: t })
  ).data;
  eq('their statement shows nothing outstanding', statement.owed, 0);
  eq('and the credit they are holding', statement.credit, 2_000_000);
  eq('with both payments on it', statement.payments.length, 2);

  step(24, 'Handing money back is a negative payment');
  // INV-0002 was a walk-in paid in full, then half of it came back. The shop
  // owes the customer until the cash is actually handed over.
  const refund = (
    await api('POST', '/payments', {
      token: t,
      key: randomUUID(),
      body: {
        amount: -(cash.total / 2),
        method: 'cash',
        note: 'Cash back for the carton returned.',
        allocations: [{ saleId: cash.id, amount: -(cash.total / 2) }],
      },
    })
  ).data;

  eq('a refund needs no customer account', refund.customerId, null);
  eq('and unwinds the allocation it points at', refund.allocated, -(cash.total / 2));
  eq(
    'so the returned sale settles back to zero',
    (await api('GET', `/sales/${cash.id}`, { token: t })).data.balance,
    0,
  );

  await api('POST', '/payments', {
    token: t,
    expect: 409,
    body: {
      customerId: shopkeeper.id,
      amount: 500_000,
      allocations: [{ saleId: cash.id, amount: -500_000 }],
    },
  });
  check('an allocation running against its payment is 409', true);

  const cleared = (await api('GET', '/receivables', { token: t })).data;
  eq('nothing is outstanding once everything is paid', cleared.invoices.length, 0);
  eq('and the total agrees', cleared.totalOutstanding, 0);

  step(25, 'Payments list, paged the same way sales are');
  await new Promise((r) => setTimeout(r, 1500));
  const banked = [];
  let payCursor = null;
  let payPages = 0;
  do {
    const page = (
      await api(
        'GET',
        `/payments?limit=2${payCursor ? `&cursor=${encodeURIComponent(payCursor)}` : ''}`,
        { token: t },
      )
    ).data;
    banked.push(...page.payments);
    payCursor = page.nextCursor;
    payPages += 1;
  } while (payCursor && payPages < 20);

  // Three counter sales banked their own payment as they were rung up, then
  // the part payment, the settlement and the refund.
  eq('every payment came back across the pages', banked.length, 6);
  check('and it actually paged', payPages > 1, `${payPages} pages`);
  eq('no id twice', new Set(banked.map((p) => p.id)).size, banked.length);
  eq(
    'a counter sale banked its own payment in the same request',
    banked.filter((p) => p.allocations.some((a) => a.sale.number === 'INV-0003')).length,
    1,
  );
  eq(
    'filtering by customer finds only theirs',
    (await api('GET', `/payments?customerId=${shopkeeper.id}`, { token: t })).data.payments
      .length,
    2,
  );

  step(26, 'Expenses: the other half of the profit subtraction');
  const categories = (await api('GET', '/expense-categories', { token: t })).data;
  eq('a new org is seeded with somewhere to file spending', categories.length, 9);
  const transport = categories.find((c) => c.name === 'transport');
  const fuel = categories.find((c) => c.name === 'fuel');
  check('including transport and fuel', !!transport && !!fuel);

  await api('POST', '/expenses', {
    token: t,
    key: randomUUID(),
    body: {
      categoryId: fuel.id,
      amount: 1_500_000,
      note: 'Diesel for the Tuesday route.',
    },
  });
  const lorry = (
    await api('POST', '/expenses', {
      token: t,
      key: randomUUID(),
      body: {
        categoryId: transport.id,
        amount: 800_000,
        method: 'transfer',
        reference: 'Receipt 4471',
      },
    })
  ).data;

  let spend = (await api('GET', '/expenses', { token: t })).data;
  eq('both are on the books', spend.expenses.length, 2);
  eq('and the period totals them', spend.total, 2_300_000);
  eq(
    'broken down per category, largest first',
    spend.byCategory.map((c) => c.name).join(', '),
    'fuel, transport',
  );
  eq(
    'filtering by category narrows it',
    (await api('GET', `/expenses?categoryId=${fuel.id}`, { token: t })).data.total,
    1_500_000,
  );

  await api('DELETE', `/expenses/${lorry.id}`, { token: t, expect: 204 });
  spend = (await api('GET', '/expenses', { token: t })).data;
  eq('a deleted expense leaves the list', spend.expenses.length, 1);
  eq('and comes off the total', spend.total, 1_500_000);
  await api('GET', `/expenses/${lorry.id}`, { token: t, expect: 404 });
  check('and is gone by id, though the row survives underneath', true);

  step(27, 'The receipt is a narrow payload, not the sale row');
  const receipt = (await api('GET', `/sales/${credit.id}/receipt`, { token: t })).data;
  eq('it names the invoice', receipt.number, 'INV-0001');
  eq('and the customer', receipt.customer, 'Chidi Okeke');
  eq('what was paid', receipt.paid, credit.total);
  eq('and what is left', receipt.balance, 0);
  check('the lines read as descriptions, not ids', !!receipt.lines[0].description);
  check('cost of goods sold never reaches the customer', receipt.costTotal === undefined);
  check('and neither does the tier', receipt.tier === undefined);

  step(28, 'Tenancy: a second organization sees none of this');
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
  eq(
    'no sales leak either',
    (await api('GET', '/sales', { token: other.token })).data.sales.length,
    0,
  );
  eq(
    'nor payments',
    (await api('GET', '/payments', { token: other.token })).data.payments.length,
    0,
  );
  eq(
    'nobody owes the new business anything',
    (await api('GET', '/receivables', { token: other.token })).data.totalOutstanding,
    0,
  );
  eq(
    'and it has spent nothing',
    (await api('GET', '/expenses', { token: other.token })).data.total,
    0,
  );
  // Its own seeded categories, which is a different set of rows entirely.
  const theirCategories = (await api('GET', '/expense-categories', { token: other.token })).data;
  eq('though it has its own categories to spend against', theirCategories.length, 9);
  check(
    'which are seeded fresh, not shared with the first org',
    theirCategories.every((c) => !categories.some((mine) => mine.id === c.id)),
  );
  // Its own catalog, and a non-stocked item so this needs no stock of its own.
  const theirProduct = (
    await api('POST', '/products', {
      token: other.token,
      body: {
        name: 'Delivery',
        basePrice: 100_000,
        trackStock: false,
        units: [{ name: 'trip', factor: 1 }],
      },
    })
  ).data;
  eq(
    'and its invoice numbering starts fresh at one',
    (
      await api('POST', '/sales', {
        token: other.token,
        body: { lines: [{ productId: theirProduct.id, quantity: 1 }] },
      })
    ).data.number,
    'INV-0001',
  );
  await api('GET', `/products/${product.id}`, { token: other.token, expect: 404 });
  check("fetching the other org's product by id is 404", true);
  await api('GET', `/sales/${credit.id}`, { token: other.token, expect: 404 });
  check("and neither is the other org's invoice", true);

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
  .finally(() => rl?.close());
