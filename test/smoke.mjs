/**
 * End-to-end smoke test for slices 0-6, against a running server.
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

/**
 * For responses that are not JSON. `api` parses the body as JSON, which a PDF
 * is not, so binary documents come through here instead.
 */
async function raw(method, path, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    throw new Error(`${method} ${path} -> ${res.status} (wanted 200)`);
  }
  return {
    type: res.headers.get('content-type'),
    disposition: res.headers.get('content-disposition') ?? '',
    body: Buffer.from(await res.arrayBuffer()),
  };
}

/**
 * Set by `api` the first time any response body contains something shaped like
 * a password hash. A blunt net, deliberately: the endpoint that leaked one was
 * never suspected, so the check that finds the next one must not depend on
 * guessing which endpoint it will be.
 */
let seenHash = null;

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
  if (!seenHash && /\$argon2|\$2[aby]\$/.test(text)) {
    seenHash = `${method} ${path}`;
  }
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
 * Counts the codes already in the log before this run registers anything.
 *
 * Without this, a second run against a log the server is still appending to
 * finds `codes.length > 0` immediately and takes the last code from the
 * *previous* run — which has expired, so verification fails with a 401 that
 * looks like a broken auth path rather than a stale read.
 */
async function primeOtpLog() {
  if (!SERVER_LOG) return;
  const log = await readFile(SERVER_LOG, 'utf8').catch(() => '');
  otpsSeen = [...log.matchAll(/verification code=(\d{6})/g)].length;
}

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
  await primeOtpLog();
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
  // Registration seeds what a business needs before its catalog is usable: the
  // price lists for its kind of trading, and the packaging vocabulary. The
  // emailed register path never asks the kind of shop, so this one is mixed —
  // Retail as the default, and Wholesale beside it (§22).
  const seededTypes = (await api('GET', '/packaging-types', { token: t })).data;
  const seededTiers = (await api('GET', '/price-tiers', { token: t })).data;
  // DEFAULT_PACKAGING_TYPES in packaging-type.service.ts: piece..keg.
  eq('a new org is seeded with the packaging vocabulary', seededTypes.length, 14);
  check(
    'ordered for shelf pickers, piece first and keg last',
    seededTypes.at(0)?.name === 'piece' && seededTypes.at(-1)?.name === 'keg',
    seededTypes.map((p) => p.name).join(', '),
  );
  eq('and two price tiers, because a shop that never said is mixed', seededTiers.length, 2);
  const seededDefault = seededTiers.filter((x) => x.isDefault);
  eq('exactly one of them is the default', seededDefault.length, 1);
  eq('and it is Retail, for the walk-in', seededDefault[0]?.name, 'Retail');
  const tier = seededTiers.find((x) => x.name === 'Wholesale');
  check('the other is Wholesale, not the default', !!tier && !tier.isDefault);

  const packaging = seededTypes.find((p) => p.name === 'tin');
  check('"tin" is one of the seeded packaging types', !!packaging);

  const category = (await api('POST', '/categories', { token: t, body: { name: 'Beverages' } })).data;
  // Wholesale is already there, so a list is added under another name — the
  // point is that adding one still works, not which one it is.
  const trade = (await api('POST', '/price-tiers', { token: t, body: { name: 'Trade' } })).data;
  check('a category and a third tier created', !!category.id && !!trade.id);

  // A new shop starts without VAT — most small shops are under the turnover
  // threshold. This one charges it, as every shop did before the switch
  // existed, so the VAT checks below have something to check. The other shop
  // in step 42 keeps the default and proves the off side.
  eq(
    'a new shop starts without VAT',
    (await api('GET', '/organization', { token: t })).data.chargesVat,
    false,
  );
  eq(
    'and can switch it on',
    (await api('PATCH', '/organization', { token: t, body: { chargesVat: true } })).data
      .chargesVat,
    true,
  );

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

  // Set through the product itself, keyed by unit name: there is no longer a
  // prices endpoint, and PATCH upserts what it lists.
  await api('PATCH', `/products/${product.id}`, {
    token: t,
    body: { prices: [{ unit: 'carton', tierId: tier.id, price: 5_400_000 }] },
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

  // One call: the product, its units, a carton price and a carton barcode.
  // Prices and barcodes are keyed by unit *name* because the units do not
  // exist until this same request creates them.
  const inOneCall = (
    await api('POST', '/products', {
      token: t,
      key: randomUUID(),
      body: {
        name: 'Bournvita Refill 500g',
        categoryId: category.id,
        basePrice: 300_000,
        units: [
          { name: 'piece', factor: 1, isDefaultSelling: true },
          { name: 'carton', factor: 12 },
        ],
        prices: [{ unit: 'carton', tierId: tier.id, price: 3_200_000 }],
        barcodes: [{ unit: 'carton', code: '5901234123457' }],
      },
    })
  ).data;

  const inlineCarton = inOneCall.units.find((u) => u.factor === 12);
  eq('a product can be created with its carton price in one call', inOneCall.prices.length, 1);
  eq('against the unit named in the same request', inOneCall.prices[0].unitId, inlineCarton.id);
  eq('and its barcode too', inOneCall.barcodes.length, 1);
  eq('on the same carton', inOneCall.barcodes[0].unitId, inlineCarton.id);

  const inlinePrice = (
    await api(
      'GET',
      `/products/${inOneCall.id}/price?unitId=${inlineCarton.id}&tierId=${tier.id}`,
      { token: t },
    )
  ).data;
  eq('the inline price is what selling resolves', inlinePrice.price, 3_200_000);
  eq('and it counts as a tier price, not the scaled fallback', inlinePrice.isTierPrice, true);

  await api('POST', '/products', {
    token: t,
    expect: 400,
    body: {
      name: 'Nothing To Price',
      basePrice: 1000,
      units: [{ name: 'piece', factor: 1 }],
      prices: [{ unit: 'crate', price: 5000 }],
    },
  });
  check('a price naming a unit the product does not have is rejected (400)', true);

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

  // The accounts customers pay into. A business commonly keeps several, so
  // that a customer can transfer into whichever bank they already use.
  const gtb = (
    await api('POST', '/bank-accounts', {
      token: t,
      key: randomUUID(),
      body: {
        bankName: 'Guaranty Trust Bank',
        accountName: 'Adebayo Stores Limited',
        accountNumber: '0123 4567-89',
        bankCode: '058',
        isDefault: true,
      },
    })
  ).data;
  eq('the account number is stored digits-only', gtb.accountNumber, '0123456789');

  const zenith = (
    await api('POST', '/bank-accounts', {
      token: t,
      key: randomUUID(),
      body: {
        bankName: 'Zenith Bank',
        accountName: 'Adebayo Stores Limited',
        accountNumber: '1010101010',
        isDefault: true,
      },
    })
  ).data;
  const accounts = (await api('GET', '/bank-accounts', { token: t })).data;
  eq('both accounts are on file', accounts.length, 2);
  eq('and the newest default won', accounts[0].id, zenith.id);
  eq('so the old one stopped being default', accounts.find((a) => a.id === gtb.id).isDefault, false);

  await api('POST', '/bank-accounts', {
    token: t,
    expect: 409,
    body: {
      bankName: 'Zenith Bank',
      accountName: 'Adebayo Stores Limited',
      accountNumber: '1010101010',
    },
  });
  check('the same account at the same bank is refused twice', true);

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
        bankAccountId: gtb.id,
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
        bankAccountId: gtb.id,
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

  step(25, 'Voiding a payment that should never have existed');

  // Stand in for a device that has already synced every payment and then goes
  // offline. The wait puts the existing rows behind the sync window, so this
  // checkpoint genuinely means "I have seen everything up to here".
  await new Promise((r) => setTimeout(r, 1500));
  const synced = (await api('GET', '/payments?limit=500', { token: t })).data;
  const checkpoint = synced.syncedThrough;
  check(
    'a client can checkpoint the payment feed',
    !!checkpoint,
    JSON.stringify(checkpoint),
  );

  // The opposite of the refund above. That one moved money; this one says the
  // money never moved, so the invoice it claimed to settle goes back to owed.
  const voided = (
    await api('POST', `/payments/${settled.id}/void`, {
      token: t,
      body: { reason: 'Keyed against the wrong account; nothing was received.' },
    })
  ).data;

  check('the row is kept, not deleted', !!voided.id);
  check('with the time it was voided', !!voided.voidedAt);
  eq(
    'and the reason, which is required',
    voided.voidedReason,
    'Keyed against the wrong account; nothing was received.',
  );
  check('and who did it', !!voided.voidedBy);
  check(
    'its allocations stay attached, so the mistake is still legible',
    voided.allocations.length > 0,
  );

  eq(
    'the invoice it had settled is owed again',
    (await api('GET', `/sales/${credit.id}`, { token: t })).data.balance,
    credit.total - 6_200_000,
  );
  eq(
    'and it is back on the receivables list',
    (await api('GET', '/receivables', { token: t })).data.totalOutstanding,
    credit.total - 6_200_000,
  );

  const afterVoid = (
    await api('GET', `/customers/${shopkeeper.id}/statement`, { token: t })
  ).data;
  eq('the credit it created is gone', afterVoid.credit, 0);
  eq('the customer owes again', afterVoid.owed, credit.total - 6_200_000);
  eq('and it is off their statement entirely', afterVoid.payments.length, 1);

  // The regression this ordering exists for. Paged by `createdAt`, the void
  // would never reach a client that had already synced this payment: the row's
  // creation time did not move, so it would sit forever behind the cursor while
  // the device went on showing the invoice as settled.
  await new Promise((r) => setTimeout(r, 1500));
  const delta = (
    await api(`GET`, `/payments?since=${encodeURIComponent(checkpoint)}`, {
      token: t,
    })
  ).data;
  const resent = delta.payments.find((p) => p.id === settled.id);
  check(
    'the void reaches a client that had already synced that payment',
    !!resent,
    delta.payments.map((p) => p.id).join(', '),
  );
  check('and it arrives carrying the void', !!resent?.voidedAt);

  await api('POST', `/payments/${settled.id}/void`, {
    token: t,
    expect: 409,
    body: { reason: 'Trying again.' },
  });
  check('voiding the same payment twice is 409', true);

  await api('POST', `/payments/${settled.id}/void`, {
    token: t,
    expect: 400,
    body: {},
  });
  check('and a void with no reason is refused', true);

  // Put it right the way the counter would: record the payment that did happen.
  const rebooked = (
    await api('POST', '/payments', {
      token: t,
      key: randomUUID(),
      body: { customerId: shopkeeper.id, amount: 12_000_000, method: 'cash' },
    })
  ).data;
  eq('the corrected payment settles it again', rebooked.allocated, credit.total - 6_200_000);
  eq(
    'and the invoice is square',
    (await api('GET', `/sales/${credit.id}`, { token: t })).data.balance,
    0,
  );

  step(26, 'Payments list, paged the same way sales are');
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
  // the part payment, the settlement, the refund, and the re-booked payment.
  // The voided one is still a row: voiding keeps it, it just stops counting.
  eq('every payment came back across the pages', banked.length, 7);
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
    3,
  );

  // The cash-up: a counter sale banks its payment at the counter that rang it
  // up, with no extra input from the person selling.
  const counterSale = banked.find((p) =>
    p.allocations.some((a) => a.sale.number === 'INV-0003'),
  );
  eq('a counter sale banks its payment at that counter', counterSale.location.id, main.id);
  eq('and names it', counterSale.location.name, 'Main Store');

  const cashUp = (await api('GET', '/reports/collections?period=today', { token: t })).data;
  const till = cashUp.byLocation.find((l) => l.locationId === main.id);
  check('the cash-up knows what the till took', till.total > 0, `${till?.total}`);
  // Payments taken away from a counter are their own row, not folded into one.
  const offTill = cashUp.byLocation.find((l) => l.locationId === 'unassigned');
  check(
    'and separates money that never touched a till',
    !!offTill,
    cashUp.byLocation.map((l) => l.label).join(', '),
  );
  eq(
    'every location adds back up to the total collected',
    cashUp.byLocation.reduce((sum, l) => sum + l.total, 0),
    cashUp.total,
  );

  // The reconciliation view: one row per account, to lay beside that account's
  // statement for the same dates.
  const intoGtb = cashUp.byBankAccount.find((row) => row.bankAccountId === gtb.id);
  check('collections are broken down per bank account', !!intoGtb, JSON.stringify(cashUp.byBankAccount));
  const unbanked = cashUp.byBankAccount.find((row) => row.bankAccountId === null);
  check('and cash is its own row rather than dropped', !!unbanked);
  eq(
    'every account adds back up to the total collected',
    cashUp.byBankAccount.reduce((sum, row) => sum + row.total, 0),
    cashUp.total,
  );

  // A transfer that does not say where it landed is unreconcilable, so it is
  // refused rather than recorded and puzzled over later.
  await api('POST', '/payments', {
    token: t,
    expect: 400,
    body: { customerId: shopkeeper.id, amount: 1_000_000, method: 'transfer' },
  });
  check('a transfer with no account named is refused', true);

  await api('POST', '/payments', {
    token: t,
    expect: 400,
    body: {
      customerId: shopkeeper.id,
      amount: 1_000_000,
      method: 'cash',
      bankAccountId: gtb.id,
    },
  });
  check('and cash cannot claim to have reached a bank', true);

  await api('DELETE', `/bank-accounts/${gtb.id}`, { token: t, expect: 409 });
  check('an account money was banked into cannot be deleted', true);

  step(27, 'Expenses: the other half of the profit subtraction');
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
      paidTo: 'Total filling station',
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
        paidTo: 'Musa (lorry hire)',
        reference: 'Receipt 4471',
      },
    })
  ).data;
  eq('an expense says who was paid', lorry.paidTo, 'Musa (lorry hire)');

  for (const paidTo of [undefined, '   ']) {
    await api('POST', '/expenses', {
      token: t,
      key: randomUUID(),
      body: { categoryId: fuel.id, amount: 1_000, ...(paidTo !== undefined && { paidTo }) },
      expect: 400,
    });
  }
  check('and one that does not — or names only spaces — is refused (400)', true);

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

  // Checkpoint a device that has seen both expenses, then delete one.
  await new Promise((r) => setTimeout(r, 1500));
  const spendSynced = (await api('GET', '/expenses?since=1970-01-01', { token: t })).data;
  eq('expenses page for sync when asked', spendSynced.expenses.length, 2);
  const spendCheckpoint = spendSynced.syncedThrough;

  await api('DELETE', `/expenses/${lorry.id}`, { token: t, expect: 204 });
  spend = (await api('GET', '/expenses', { token: t })).data;
  eq('a deleted expense leaves the list', spend.expenses.length, 1);
  eq('and comes off the total', spend.total, 1_500_000);
  await api('GET', `/expenses/${lorry.id}`, { token: t, expect: 404 });
  check('and is gone by id, though the row survives underneath', true);

  // Same rule as the payment void: a device that already has this expense has
  // to be told it went away, or it keeps showing spending that was retracted.
  await new Promise((r) => setTimeout(r, 1500));
  const spendDelta = (
    await api(
      'GET',
      `/expenses?since=${encodeURIComponent(spendCheckpoint)}&includeDeleted=true`,
      { token: t },
    )
  ).data;
  const tombstone = spendDelta.expenses.find((e) => e.id === lorry.id);
  check('the deletion reaches a syncing client', !!tombstone, `${spendDelta.expenses.length} rows`);
  check('as a tombstone it can act on', !!tombstone?.deletedAt);
  eq(
    'while the totals still ignore what was deleted',
    spendDelta.total,
    1_500_000,
  );

  step(28, 'The receipt is a narrow payload, not the sale row');
  const receipt = (await api('GET', `/sales/${credit.id}/receipt`, { token: t })).data;
  eq('it names the invoice', receipt.number, 'INV-0001');
  eq('and the customer', receipt.customer, 'Chidi Okeke');
  eq('what was paid', receipt.paid, credit.total);
  eq('and what is left', receipt.balance, 0);
  check('the lines read as descriptions, not ids', !!receipt.lines[0].description);
  check('cost of goods sold never reaches the customer', receipt.costTotal === undefined);
  check('and neither does the tier', receipt.tier === undefined);

  // The letterhead a printed document carries. Every field is nullable, so the
  // PDF below is also rendered once with none of it filled in.
  const profile = (
    await api('PATCH', '/organization', {
      token: t,
      body: {
        address: '12 Oba Akran Avenue, Ikeja, Lagos',
        phone: '+2348012345678',
        email: 'sales@adebayostores.ng',
        taxId: '01234567-0001',
        rcNumber: 'RC 1234567',
      },
    })
  ).data;
  eq('the business details are stored', profile.rcNumber, 'RC 1234567');
  check('and the timezone is not editable here', profile.timezone === 'Africa/Lagos');

  const invoicePdf = await raw('GET', `/sales/${credit.id}/invoice.pdf`, t);
  eq('the invoice is served as a PDF', invoicePdf.type, 'application/pdf');
  check('and it really is one', invoicePdf.body.subarray(0, 5).toString() === '%PDF-');
  check(
    'named after the invoice it prints',
    invoicePdf.disposition.includes('invoice-INV-0001.pdf'),
    invoicePdf.disposition,
  );

  const statementPdf = await raw('GET', `/customers/${shopkeeper.id}/statement.pdf`, t);
  eq('the statement is a PDF too', statementPdf.type, 'application/pdf');
  check('and really one', statementPdf.body.subarray(0, 5).toString() === '%PDF-');

  // -- Slice 6: reports ----------------------------------------------------
  step(29, 'Reports reconcile with the rows they summarise');
  // The load-bearing property of this slice, and the analogue of the ledger-sum
  // check in step 19: a report that quietly disagrees with the transactional
  // endpoints is the failure mode, and nothing else catches it.

  const soldInvoices = (await api('GET', '/sales?limit=100', { token: t })).data.sales;
  const grossSales = soldInvoices.reduce((sum, s) => sum + s.total, 0);
  const salesExTax = soldInvoices.reduce((sum, s) => sum + s.total - s.taxTotal, 0);
  // The one carton that came back, and the VAT inside its refund.
  const refunded = cash.total / 2;
  const refundNet = Math.round((refunded * 10_000) / 10_750);

  const profit = (await api('GET', '/reports/profit?period=today', { token: t })).data;
  eq('gross sales match the invoices themselves', profit.grossSales, grossSales);
  eq('and the return is accounted for', profit.returned, refunded);
  eq(
    'revenue is tax-exclusive and net of returns',
    profit.revenue,
    salesExTax - (refunded - (refunded - refundNet)),
  );
  check('which is less than the money that changed hands', profit.revenue < grossSales);
  eq('gross profit is revenue less cost', profit.grossProfit, profit.revenue - profit.cogs);
  eq('expenses come off to reach the operating figure', profit.expenses, 1_500_000);
  eq(
    'operating profit is gross profit less expenses',
    profit.operatingProfit,
    profit.grossProfit - 1_500_000,
  );

  step(30, 'The dashboard: what I sold, and what I actually collected');
  const dash = (await api('GET', '/reports/dashboard', { token: t })).data;

  eq('it reports in the organisation timezone', dash.timezone, 'Africa/Lagos');
  eq('sales agree with the profit report', dash.sales.monthGross, grossSales);
  eq('so does revenue', dash.sales.month, profit.revenue);

  // The distinction the dashboard exists to draw. Six payments stand, one was
  // voided, and the voided one must not be money the business thinks it has.
  const standing = (await api('GET', '/payments?limit=100', { token: t })).data.payments
    .filter((p) => !p.voidedAt)
    .reduce((sum, p) => sum + p.amount, 0);
  eq('collections count every payment that stands', dash.collections.month, standing);
  check(
    'and exclude the voided one',
    dash.collections.month !== standing + 12_000_000,
    `${dash.collections.month}`,
  );
  check(
    'sales and collections are different numbers, which is the point',
    dash.collections.month !== dash.sales.monthGross,
  );

  eq(
    'receivables agree with the receivables endpoint',
    dash.receivables.total,
    (await api('GET', '/receivables', { token: t })).data.totalOutstanding,
  );
  eq('and the profit block agrees too', dash.profit.operatingProfit, profit.operatingProfit);
  check('the trend covers 30 days', dash.trend.days.length === 30, `${dash.trend.days.length}`);
  eq('the last of which is today', dash.trend.days.at(-1).grossSales, grossSales);

  step(31, 'Stock valuation reconciles with the ledger');
  const valuation = (await api('GET', '/reports/stock-valuation', { token: t })).data;
  // Step 19 proved the ledger sums to 134 base units. The valuation walks the
  // same balances, so if it disagrees, one of the two is wrong.
  eq('valuation covers exactly the stock the ledger says exists', valuation.units, 134);
  check('and it is worth something', valuation.total > 0, `${valuation.total}`);
  eq(
    'the shortfall on the van is carried as negative value, not clamped',
    valuation.byLocation.find((l) => l.label === "Ibrahim's Van").units,
    -48,
  );
  check(
    'Main Store holds the rest',
    valuation.byLocation.find((l) => l.label === 'Main Store').units === 182,
  );

  step(32, 'Alerts: out of stock, and below a level somebody set');
  let alerts = (await api('GET', '/reports/stock-alerts', { token: t })).data;
  check(
    'nothing is flagged low while no product has a reorder point',
    alerts.lowStock.length === 0,
    `${alerts.lowStock.length}`,
  );
  check('and the report says how many have none', alerts.withoutReorderPoint > 0);

  await api('PATCH', `/products/${product.id}`, {
    token: t,
    body: { reorderPoint: 200 },
  });
  alerts = (await api('GET', '/reports/stock-alerts', { token: t })).data;
  eq('setting a level puts the product on the low-stock list', alerts.lowStock.length, 1);
  eq('with the level it was given', alerts.lowStock[0].reorderPoint, 200);
  // 134 across both locations, not 182 at Main Store: the level is per product.
  eq('measured across every location at once', alerts.lowStock[0].quantity, 134);

  step(33, 'Sales sliced by product, by customer, and by day');
  const byProduct = (
    await api('GET', '/reports/sales?period=today&groupBy=product', { token: t })
  ).data;
  eq('every line is grouped', byProduct.groupBy, 'product');
  eq('the totals still match the invoices', byProduct.totals.grossSales, grossSales);
  const milk = byProduct.rows.find((r) => r.label === 'Peak Milk 400g');
  check('the stocked product carries a margin', milk.marginBps > 0, `${milk.marginBps}`);
  const delivery = byProduct.rows.find((r) => r.label === 'Delivery to Ikeja');
  eq('a service has no cost of goods, so it is all margin', delivery.cogs, 0);

  const byCustomer = (
    await api('GET', '/reports/sales?period=today&groupBy=customer', { token: t })
  ).data;
  check(
    'walk-ins are one bucket and the account is another',
    byCustomer.rows.some((r) => r.key === 'walk-in') &&
      byCustomer.rows.some((r) => r.key === shopkeeper.id),
    byCustomer.rows.map((r) => r.label).join(', '),
  );

  const byDay = (await api('GET', '/reports/sales?period=today&groupBy=day', { token: t })).data;
  eq('a single day groups into a single row', byDay.rows.length, 1);
  eq('holding the whole day', byDay.rows[0].grossSales, grossSales);

  step(34, 'Expiry, movers and the audit trail');
  const expiringSoon = (await api('GET', '/reports/expiry?withinDays=3650', { token: t })).data;
  check('the dated lot is listed', expiringSoon.batches.length > 0, `${expiringSoon.batches.length}`);
  check('with value at risk attached', expiringSoon.valueAtRisk > 0);
  check(
    'soonest first, which is the order FEFO will take them',
    expiringSoon.batches.every(
      (b, i, all) => i === 0 || new Date(all[i - 1].expiryDate) <= new Date(b.expiryDate),
    ),
  );

  const movers = (await api('GET', '/reports/products?period=today', { token: t })).data;
  check('there is a best seller', movers.topByRevenue.length > 0);
  eq('and it is the milk', movers.topByRevenue[0].label, 'Peak Milk 400g');

  const audit = (await api('GET', '/reports/stock-audit?period=today', { token: t })).data;
  check('the forced movements are on the audit report', audit.forced > 0, `${audit.forced}`);
  check('with a reason grouping', audit.byReason.length > 0);

  const customers = (await api('GET', '/reports/customers?period=today', { token: t })).data;
  const account = customers.customers.find((c) => c.customer.id === shopkeeper.id);
  eq('the customer report knows what they spent', account.invoices, 1);
  eq('and that they have settled up', account.balance, 0);
  check('and when they last bought', !!account.lastPurchase);

  step(35, 'Credit is exceptional: clear the last one before taking more');
  // The shopkeeper settled up in step 25, so the first credit sale is allowed.
  const onCredit = (
    await api('POST', '/sales', {
      token: t,
      key: randomUUID(),
      body: {
        customerId: shopkeeper.id,
        locationId: main.id,
        payment: { amount: 0 },
        lines: [{ productId: product.id, unitId: carton.id, quantity: 1 }],
      },
    })
  ).data;
  eq('a customer who owes nothing can take goods on credit', onCredit.balance, onCredit.total);

  // A second one, while the first still stands, is refused.
  await api('POST', '/sales', {
    token: t,
    expect: 409,
    body: {
      customerId: shopkeeper.id,
      locationId: main.id,
      payment: { amount: 0 },
      lines: [{ productId: product.id, unitId: carton.id, quantity: 1 }],
    },
  });
  check('a second credit sale is refused while the first is unpaid', true);

  // The rule is about credit, not about the customer. Paying settles nothing
  // owed, but it is not a debt either, so it goes through.
  const paidUp = (
    await api('POST', '/sales', {
      token: t,
      key: randomUUID(),
      body: {
        customerId: shopkeeper.id,
        locationId: main.id,
        lines: [{ productId: product.id, unitId: carton.id, quantity: 1 }],
      },
    })
  ).data;
  eq('but the same customer can still buy for cash', paidUp.balance, 0);

  // And an owner can overrule it, on the record.
  const overridden = (
    await api('POST', '/sales', {
      token: t,
      key: randomUUID(),
      body: {
        customerId: shopkeeper.id,
        locationId: main.id,
        payment: { amount: 0 },
        creditOverrideReason: 'Owner approved; paying both on Friday.',
        lines: [{ productId: product.id, unitId: carton.id, quantity: 1 }],
      },
    })
  ).data;
  eq(
    'an owner can overrule it, and the reason is kept on the sale',
    overridden.creditOverrideReason,
    'Owner approved; paying both on Friday.',
  );
  eq('the override still leaves the money owed', overridden.balance, overridden.total);

  step(36, 'Product images');
  // A business that already hosts its product shots sets the URL directly, and
  // needs no image hosting configured at all.
  const pictured = (
    await api('PATCH', `/products/${product.id}`, {
      token: t,
      body: { imageUrl: 'https://cdn.example.com/peak-milk-400g.jpg' },
    })
  ).data;
  eq(
    'a product can point at an image hosted elsewhere',
    pictured.imageUrl,
    'https://cdn.example.com/peak-milk-400g.jpg',
  );
  eq(
    'and it is not claimed as ours to delete',
    pictured.imagePublicId,
    null,
  );

  // Uploading needs Cloudinary, which is unset on a development machine. The
  // failure has to say so rather than surfacing as a stack trace from the SDK.
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'x.png');
  const upload = await fetch(`${BASE}/products/${product.id}/image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}` },
    body: form,
  });
  eq('uploading without image hosting configured is a 503', upload.status, 503);
  check(
    'and it names the variables to set',
    (await upload.text()).includes('CLOUDINARY_CLOUD_NAME'),
  );

  const unpictured = (await api('DELETE', `/products/${product.id}/image`, { token: t })).data;
  eq('the picture can be removed again', unpictured.imageUrl, null);

  step(37, 'Cost when the goods outrun the paperwork');
  // A product received at Main Store, then force-sold from the van, where it
  // has never been stocked. The ledger has to invent a batch to carry the
  // shortfall, and that batch has no invoice behind it.
  const lateProduct = (
    await api('POST', '/products', {
      token: t,
      body: {
        name: 'Shea Butter 200ml',
        basePrice: 120_000,
        units: [
          { name: 'jar', factor: 1 },
          { name: 'carton', factor: 12 },
        ],
      },
    })
  ).data;
  const lateCarton = lateProduct.units.find((u) => u.name === 'carton');

  // 10 cartons of 12 for ₦1,080,000 — ₦9,000 a jar, exactly.
  await api('POST', '/goods-receipts', {
    token: t,
    key: randomUUID(),
    body: {
      supplierId: supplier.id,
      locationId: main.id,
      lines: [
        {
          productId: lateProduct.id,
          unitId: lateCarton.id,
          quantityReceived: 10,
          quantityPaidFor: 10,
          totalCost: 108_000_000,
        },
      ],
    },
  });

  const soldEarly = (
    await api('POST', '/sales', {
      token: t,
      key: randomUUID(),
      body: {
        locationId: van.id,
        force: true,
        forcedReason: 'Sold off the van before the delivery note was entered.',
        lines: [{ productId: lateProduct.id, unitId: lateCarton.id, quantity: 1 }],
      },
    })
  ).data;

  // The bug this replaced: cost came out as zero, reporting 100% margin and
  // leaving the real cost out of every report for good.
  const earlyLine = soldEarly.lines[0];
  check('a forced sale is not costed at nothing', earlyLine.costOfGoodsSold > 0, `${earlyLine.costOfGoodsSold}`);
  eq(
    'it borrows the rate from the last real delivery',
    earlyLine.costOfGoodsSold,
    12 * 900_000,
  );
  eq('and the line says the cost is a guess', earlyLine.costIsEstimated, true);

  await new Promise((r) => setTimeout(r, 1500));
  const guessed = (await api('GET', '/reports/profit?period=today', { token: t })).data;
  check(
    'the profit report says how much margin rests on an estimate',
    guessed.estimatedCost >= 12 * 900_000,
    `${guessed.estimatedCost}`,
  );
  check('and how many lines', guessed.estimatedLines >= 1, `${guessed.estimatedLines}`);

  step(38, 'Stocktake: counting is not adjusting');
  const beforeCount = await levelAt(t, product.id, main.id);

  const sheet = (
    await api('POST', '/stocktakes', {
      token: t,
      key: randomUUID(),
      body: { locationId: main.id, note: 'Month-end count, main store.' },
    })
  ).data;
  eq('a count opens against a location', sheet.location.id, main.id);
  eq('and starts open', sheet.status, 'open');

  await api('POST', '/stocktakes', {
    token: t,
    expect: 409,
    body: { locationId: main.id },
  });
  check('a second open count at the same location is refused', true);

  // Three tins are missing from the shelf.
  const counted = (
    await api('POST', `/stocktakes/${sheet.id}/lines`, {
      token: t,
      body: {
        lines: [
          {
            productId: product.id,
            countedQuantity: beforeCount - 3,
            note: 'Three tins unaccounted for.',
          },
        ],
      },
    })
  ).data;

  eq('the sheet knows what the ledger expected', counted.lines[0].expectedQuantity, beforeCount);
  eq('and what was actually there', counted.lines[0].countedQuantity, beforeCount - 3);
  eq('so the variance is the difference', counted.lines[0].variance, -3);
  eq('which is one discrepancy', counted.discrepancies, 1);

  // The point of having two steps: recording a count moves nothing.
  eq(
    'recording the count leaves stock exactly as it was',
    await levelAt(t, product.id, main.id),
    beforeCount,
  );

  const postKey = randomUUID();
  const postedCount = (
    await api('POST', `/stocktakes/${sheet.id}/post`, { token: t, key: postKey })
  ).data;
  eq('posting writes one correction', postedCount.corrections, 1);
  eq('and closes the count', postedCount.status, 'posted');
  eq('now the shelf and the ledger agree', await levelAt(t, product.id, main.id), beforeCount - 3);

  await api('POST', `/stocktakes/${sheet.id}/post`, { token: t, expect: 409 });
  check('posting the same count twice is 409', true);

  // A surplus has no lot of its own, so it has to be given one.
  const surplusSheet = (
    await api('POST', '/stocktakes', {
      token: t,
      key: randomUUID(),
      body: { locationId: main.id },
    })
  ).data;
  await api('POST', `/stocktakes/${surplusSheet.id}/lines`, {
    token: t,
    body: {
      lines: [{ productId: product.id, countedQuantity: beforeCount - 1 }],
    },
  });
  // The same key, aimed at a different count. This route carries no body, so
  // when the endpoint was matched on the route *pattern* both requests looked
  // identical: the second replayed the first answer and posted nothing, leaving
  // the surplus off the shelf with no error to notice.
  const beforeReuse = await levelAt(t, product.id, main.id);
  await api('POST', `/stocktakes/${surplusSheet.id}/post`, {
    token: t,
    key: postKey,
    expect: 409,
  });
  check('one key cannot post two different counts', true);
  eq(
    'and the count it was aimed at is left alone',
    await levelAt(t, product.id, main.id),
    beforeReuse,
  );

  const postedSurplus = (
    await api('POST', `/stocktakes/${surplusSheet.id}/post`, {
      token: t,
      key: randomUUID(),
    })
  ).data;
  eq('a surplus posts too', postedSurplus.corrections, 1);
  eq(
    'and the found stock is on the shelf',
    await levelAt(t, product.id, main.id),
    beforeCount - 1,
  );

  await new Promise((r) => setTimeout(r, 1500));
  const audited = (await api('GET', '/reports/stock-audit?period=today', { token: t })).data;
  check(
    'the corrections show up on the audit report as count corrections',
    audited.byReason.some((r) => r.reason === 'count_correction'),
    audited.byReason.map((r) => r.reason).join(', '),
  );

  // The invariant the whole suite rests on, re-checked after the ledger has
  // been corrected: the movements still add up to the levels.
  const finalMovements = (await api('GET', '/stock/movements?limit=1000', { token: t })).data
    .movements;
  const finalLevels = (await api('GET', '/stock/levels?includeEmpty=true', { token: t })).data;
  eq(
    'and the ledger still sums to what the levels say',
    finalMovements.reduce((sum, m) => sum + m.quantity, 0),
    finalLevels.reduce((sum, row) => sum + row.quantity, 0),
  );

  step(39, 'Staff: an owner adds a cashier who has no email address');
  const ownerMe = (await api('GET', '/auth/me', { token: t })).data;
  const cashier = (
    await api('POST', '/staff', {
      token: t,
      key: randomUUID(),
      body: {
        firstName: 'Amina',
        lastName: 'Bello',
        username: 'amina',
        password: 'first-password-change-it',
        role: 'sales_rep',
      },
    })
  ).data;
  eq('the username is qualified by the shop', cashier.user.username.split('@')[1] !== undefined, true);
  eq('and she has no email at all', cashier.user.email, null);
  check('created already verified, since no code could ever reach her', cashier.user.isVerified);

  // Open the shop for the whole day before any cashier tries to sign in.
  //
  // A new organization defaults to 08:00-19:00 and non-owners are refused a
  // session outside that window, so everything below here used to pass only
  // when the run itself happened during business hours — an evening run died
  // on a 403 that was the feature working exactly as intended. The working
  // hours section further down shuts the shop explicitly to test the refusal,
  // so starting open weakens nothing.
  await api('PATCH', '/organization', {
    token: t,
    body: { opensAt: 0, closesAt: 1440 },
  });

  // The point of the whole feature: she can actually sign in.
  const aminaLogin = (
    await api('POST', '/auth/login', {
      body: { username: cashier.user.username, password: 'first-password-change-it' },
    })
  ).data;
  const aminaToken = aminaLogin.accessToken ?? aminaLogin.tokens?.accessToken;
  check('a cashier with no email can sign in with her username', !!aminaToken);

  const aminaMe = (await api('GET', '/auth/me', { token: aminaToken })).data;
  eq('and she lands in her employer’s business', aminaMe.organizationId, ownerMe.organizationId);
  eq('with the role she was given', aminaMe.orgRole, 'sales_rep');

  // A rep may sell but not see what the goods cost (§12).
  await api('GET', '/reports/profit?period=today', { token: aminaToken, expect: 403 });
  check('her role is enforced: no cost reports', true);

  // Owner-only writes.
  await api('POST', '/staff', {
    token: aminaToken,
    expect: 403,
    body: { firstName: 'Sneaky', username: 'sneaky', password: 'password123', role: 'owner' },
  });
  check('and she cannot hire anybody', true);

  await api('POST', '/staff', {
    token: t,
    expect: 409,
    body: { firstName: 'Amina', username: 'amina', password: 'password123', role: 'sales_rep' },
  });
  check('the same username twice in one shop is refused', true);

  // The seat cap. One owner plus Amina, on a five-seat plan: three left.
  for (const name of ['bola', 'chidi', 'dele']) {
    await api('POST', '/staff', {
      token: t,
      key: randomUUID(),
      body: { firstName: name, username: name, password: 'password123', role: 'sales_rep' },
    });
  }
  await api('POST', '/staff', {
    token: t,
    expect: 409,
    body: { firstName: 'Sixth', username: 'sixth', password: 'password123', role: 'sales_rep' },
  });
  check('a sixth active person is refused on a five-seat plan', true);

  // Suspension frees a seat, and locks her out on the very next request.
  await api('DELETE', `/staff/${cashier.user.id}`, { token: t });
  await api('GET', '/products', { token: aminaToken, expect: 401 });
  check('a suspended cashier is locked out immediately, not when her token expires', true);

  await api('POST', '/staff', {
    token: t,
    key: randomUUID(),
    body: { firstName: 'Sixth', username: 'sixth', password: 'password123', role: 'sales_rep' },
  });
  check('and her seat is free for somebody else', true);

  // -- Working hours ------------------------------------------------------
  // Bola works here and is not an owner, so the shop's hours apply to her.
  const bola = (await api('GET', '/staff', { token: t })).data.find(
    (m) => m.user.username?.startsWith('bola@'),
  );
  const signInAsBola = (expect) =>
    api('POST', '/auth/login', {
      expect,
      body: { username: bola.user.username, password: 'password123' },
    });

  const openNow = (await signInAsBola([200, 201])).data;
  const bolaToken = openNow.accessToken ?? openNow.tokens?.accessToken;
  check('a cashier can sign in during opening hours', !!bolaToken);

  // Close the shop by moving the window into the past hour.
  const nowMinutes = (() => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    return (get('hour') % 24) * 60 + get('minute');
  })();
  const shut = { opensAt: Math.max(0, nowMinutes - 120), closesAt: Math.max(1, nowMinutes - 60) };
  await api('PATCH', '/organization', { token: t, body: shut });

  await signInAsBola(403);
  check('and is refused once the shop has closed', true);

  // The owner is never locked out of their own business.
  const ownerLogin = await api('POST', '/auth/login', {
    body: { email: org.email, password: 'correct-horse-battery' },
  });
  check('while the owner can still sign in after hours', ownerLogin.status === 200 || ownerLogin.status === 201);

  // The token she already holds keeps working: hours are checked when a session
  // is issued, never on an ordinary request, so nobody is cut off mid-sale.
  await api('GET', '/products', { token: bolaToken });
  check('a cashier already working is not cut off mid-request', true);

  // An exemption puts her back in.
  await api('PATCH', `/staff/${bola.user.id}`, {
    token: t,
    body: { ignoresWorkingHours: true },
  });
  await signInAsBola([200, 201]);
  check('an exempt member of staff can sign in at any hour', true);

  // Her own hours are checked through the record rather than another sign-in:
  // login is throttled at five a minute per address, and this step has already
  // spent them. The override itself is covered in working-hours.spec.ts.
  const withOwnHours = (
    await api('PATCH', `/staff/${bola.user.id}`, {
      token: t,
      body: { ignoresWorkingHours: false, opensAt: 0, closesAt: 1440 },
    })
  ).data;
  eq('her own hours are stored against her', withOwnHours.opensAt, 0);
  eq('and the exemption is cleared again', withOwnHours.ignoresWorkingHours, false);

  await api('PATCH', '/organization', {
    token: t,
    expect: 400,
    body: { opensAt: 1200, closesAt: 600 },
  });
  check('closing before opening is refused: no shift crosses midnight yet', true);

  // Put the shop back, so later steps are unaffected.
  await api('PATCH', '/organization', { token: t, body: { opensAt: 0, closesAt: 1440 } });

  step(40, 'Vendor targets: cartons of a category, against what arrived');
  // A target is a category and a number of cartons (DECISIONS.md §12,
  // 2026-10-04). Each product's carton is its biggest unit — here, 24 tins.
  const targetMonth = new Date().toISOString();

  const catTarget = (
    await api('POST', '/purchase-targets', {
      token: t,
      key: randomUUID(),
      body: {
        supplierId: supplier.id,
        categoryId: category.id,
        period: targetMonth,
        targetCartons: 100,
      },
    })
  ).data;
  eq('a target is a number of cartons', catTarget.targetCartons, 100);
  eq('against a category', catTarget.category.id, category.id);

  const targetsOf = async (id) => {
    const report = (
      await api('GET', `/purchase-targets/report?supplierId=${supplier.id}`, { token: t })
    ).data;
    return report.targets.find((row) => row.id === id).progress;
  };

  const before = await targetsOf(catTarget.id);
  check(
    'the target already counts what this month has delivered',
    before.achievedCartons > 0,
    `${before.achievedCartons} cartons`,
  );

  // 10 cartons arrive, the invoice charges for 9.
  await api('POST', '/goods-receipts', {
    token: t,
    key: randomUUID(),
    body: {
      supplierId: supplier.id,
      locationId: main.id,
      invoiceNumber: 'INV-TARGET',
      lines: [
        {
          productId: product.id,
          unitId: carton.id,
          quantityReceived: 10,
          quantityPaidFor: 9,
          totalCost: 9_000_000,
          lotCode: 'LOT-TARGET',
        },
      ],
    },
  });

  const after = await targetsOf(catTarget.id);
  eq(
    'free goods do not advance the quota: 9 cartons, not 10',
    Math.round((after.achievedCartons - before.achievedCartons) * 10) / 10,
    9,
  );
  check(
    'progress is reported against the target',
    after.achievedBps === Math.round((after.achievedCartons / 100) * 10000) ||
      Math.abs(after.achievedBps - (after.achievedCartons / 100) * 10000) <= 5,
    `${after.achievedBps} bps for ${after.achievedCartons} cartons`,
  );

  const edited = (
    await api('PATCH', `/purchase-targets/${catTarget.id}`, {
      token: t,
      body: { targetCartons: 120, note: 'Raised mid-month' },
    })
  ).data;
  eq('a target can be edited: the number of cartons', edited.targetCartons, 120);
  eq('and the note', edited.note, 'Raised mid-month');

  await api('PATCH', `/purchase-targets/${catTarget.id}`, {
    token: t,
    expect: 400,
    body: { categoryId: randomUUID() },
  });
  check('but not what it is set against', true);

  await api('POST', '/purchase-targets', {
    token: t,
    expect: 409,
    body: {
      supplierId: supplier.id,
      categoryId: category.id,
      period: targetMonth,
      targetCartons: 10,
    },
  });
  check('a second target for the same vendor, category and month is refused', true);

  await api('POST', '/purchase-targets', {
    token: t,
    expect: 400,
    body: {
      supplierId: supplier.id,
      categoryId: category.id,
      period: targetMonth,
      targetCartons: 10,
      targetValue: 50_000_000,
    },
  });
  check('a money quota is no longer part of a target', true);

  const dashboardTargets = (await api('GET', '/reports/dashboard', { token: t })).data
    .purchasing.targets;
  check(
    'the dashboard carries the target, in cartons, for its doughnut',
    dashboardTargets.some(
      (row) => row.id === catTarget.id && row.targetCartons === 120 && row.category === category.name,
    ),
    JSON.stringify(dashboardTargets),
  );

  // A vendor's money target for the month, beside the cartons: one figure,
  // counted from the invoice value of what arrived, with VAT taken off when the
  // vendor adds it on top.
  const moneyTarget = (
    await api('POST', '/purchase-targets/money', {
      token: t,
      key: randomUUID(),
      body: { supplierId: supplier.id, period: targetMonth, amount: 1_200_000_000, addsVat: true },
    })
  ).data;
  check('a vendor money target is set', !!moneyTarget.id);
  await api('POST', '/purchase-targets/money', {
    token: t,
    key: randomUUID(),
    body: { supplierId: supplier.id, period: targetMonth, amount: 1 },
    expect: 409,
  });
  check('one money target per vendor per month', true);

  const moneyOf = async () =>
    (await api('GET', `/purchase-targets/report?supplierId=${supplier.id}`, { token: t })).data.moneyTargets.find(
      (row) => row.id === moneyTarget.id,
    );
  const withVat = await moneyOf();
  check('it counts what arrived from the vendor this month', withVat.invoiced > 0, `${withVat.invoiced}`);
  eq(
    'with the VAT taken off when the vendor adds it',
    withVat.counted,
    Math.round((withVat.invoiced * 10_000) / 10_750),
  );
  await api('PATCH', `/purchase-targets/money/${moneyTarget.id}`, { token: t, body: { addsVat: false } });
  eq('and whole when the vendor adds none', (await moneyOf()).counted, withVat.invoiced);
  check(
    'the dashboard carries it for its doughnut',
    (await api('GET', '/reports/dashboard', { token: t })).data.purchasing.moneyTargets.some(
      (row) => row.id === moneyTarget.id && row.amount === 1_200_000_000,
    ),
  );

  // -- Payables -------------------------------------------------------------
  // The owner's own worked example, in kobo: ₦199,800 supplied with ₦71,800
  // handed over on the spot, ₦32,000 supplied and untouched, ₦64,000 supplied
  // and untouched. The total owed should read ₦224,000.
  step(41, 'Payables: what I owe my vendors');

  const owedBefore = (await api('GET', '/payables', { token: t })).data.total;

  // A delivery that is part-paid at the door, in one request.
  const partPaid = (
    await api('POST', '/goods-receipts', {
      token: t,
      key: randomUUID(),
      body: {
        supplierId: supplier.id,
        locationId: main.id,
        invoiceNumber: 'DN-199800',
        lines: [
          {
            productId: product.id,
            unitId: carton.id,
            quantityReceived: 4,
            totalCost: 19_980_000,
            lotCode: 'LOT-PAYABLE-1',
          },
        ],
        payment: { amount: 7_180_000, method: 'cash' },
      },
    })
  ).data;
  check('a delivery can be part-paid at the door in one request', !!partPaid.id);

  const billOf = async (receiptId) => {
    const bills = (await api('GET', '/supplier-bills', { token: t })).data;
    return bills.find((row) => row.goodsReceipt?.id === receiptId);
  };

  const firstBill = await billOf(partPaid.id);
  eq('the delivery raised a bill for the invoice total', firstBill.amountDue, 19_980_000);
  eq('the money handed over is already against it', firstBill.paid, 7_180_000);
  eq('leaving the balance the owner would expect', firstBill.balance, 12_800_000);

  // Two opening balances: what was already owed before any of this existed.
  const opening = async (amount, daysAgo, invoiceNumber) =>
    (
      await api('POST', '/supplier-bills', {
        token: t,
        key: randomUUID(),
        body: {
          supplierId: supplier.id,
          amountDue: amount,
          invoiceNumber,
          issuedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
        },
      })
    ).data;

  const stockBefore = (await api('GET', '/stock/levels', { token: t })).data.length;
  const older = await opening(3_200_000, 17, 'OPEN-32000');
  await opening(6_400_000, 2, 'OPEN-64000');
  const stockAfter = (await api('GET', '/stock/levels', { token: t })).data.length;

  // The load-bearing property of an opening balance: it is money, not goods.
  eq('an opening balance moves no stock at all', stockAfter, stockBefore);
  eq('and it carries no goods receipt', older.goodsReceipt, null);

  const owedNow = (await api('GET', '/payables', { token: t })).data;
  eq(
    'the three unpaid supplies come to ₦224,000 above where we started',
    owedNow.total - owedBefore,
    22_400_000,
  );
  check('and the list behind the total is what a click opens', owedNow.bills.length >= 3);
  check('grouped per vendor, biggest debt first', owedNow.bySupplier.length >= 1);
  check('with the longest-owed reported', owedNow.oldestDays >= 17, `${owedNow.oldestDays} days`);

  // Paying the rest of the part-paid delivery.
  const settle = (
    await api('POST', '/supplier-payments', {
      token: t,
      key: randomUUID(),
      body: { billId: firstBill.id, amount: 12_800_000, method: 'cash' },
    })
  ).data;
  check('the balance of a delivery can be settled later', !!settle.id);

  const clearedBill = await billOf(partPaid.id);
  eq('which clears that bill', clearedBill.balance, 0);

  // Overpaying is refused: the vendor is not owed it.
  await api('POST', '/supplier-payments', {
    token: t,
    key: randomUUID(),
    expect: 409,
    body: { billId: firstBill.id, amount: 100, method: 'cash' },
  });
  check('paying a vendor more than they are owed is refused', true);

  // Voiding says the money never moved, so the debt comes back.
  await api('POST', `/supplier-payments/${settle.id}/void`, {
    token: t,
    body: { reason: 'Keyed against the wrong delivery.' },
  });
  const reopened = await billOf(partPaid.id);
  eq('voiding a payment puts the bill back to owing', reopened.balance, 12_800_000);

  // A bill paid long before it was entered: the payment carries the day the
  // money left, as the "Paid on" box sends it — noon UTC on the day picked.
  const paidDay = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const backdated = (
    await api('POST', '/supplier-payments', {
      token: t,
      key: randomUUID(),
      body: { billId: older.id, amount: 3_200_000, method: 'cash', occurredAt: `${paidDay}T12:00:00.000Z` },
    })
  ).data;
  eq('a payment made earlier keeps the day it was made', backdated.occurredAt.slice(0, 10), paidDay);
  const settledBill = (await api('GET', `/supplier-bills/${older.id}`, { token: t })).data;
  eq('and settles the bill all the same', settledBill.balance, 0);
  // What the Bills screen shows when a bill is opened: its payments, which
  // add up to what it says was paid.
  eq(
    'the bill lists the payments that add up to what was paid',
    settledBill.payments.reduce((sum, row) => sum + row.amount, 0),
    settledBill.paid,
  );
  check('and each says which account it left, or none for cash', settledBill.payments.every((row) => 'bankAccount' in row));

  // Vendor rebates: expected for a month, then credited off a later bill. Not
  // a payment and not an expense — a term in what the bill owes, and a line of
  // its own in profit, in the month the credit landed.
  const profitBefore = (await api('GET', '/reports/profit?period=month', { token: t })).data;
  const rebate = (
    await api('POST', '/vendor-rebates', {
      token: t,
      key: randomUUID(),
      body: { supplierId: supplier.id, period: new Date().toISOString(), expectedAmount: 150_000, note: 'Met the month.' },
    })
  ).data;
  eq('a rebate is recorded as expected', rebate.status, 'expected');
  await api('POST', '/vendor-rebates', {
    token: t,
    key: randomUUID(),
    body: { supplierId: supplier.id, period: new Date().toISOString(), expectedAmount: 1 },
    expect: 409,
  });
  check('one rebate per vendor per month', true);

  // The next bill, dated today, that the credit comes off.
  const nextBill = await opening(500_000, 0, 'REBATE-NEXT');
  await api('POST', `/vendor-rebates/${rebate.id}/credit`, {
    token: t,
    key: randomUUID(),
    body: { billId: nextBill.id, amount: 500_001 },
    expect: 409,
  });
  check('a credit bigger than the bill is refused, not carried', true);

  const credited = (
    await api('POST', `/vendor-rebates/${rebate.id}/credit`, {
      token: t,
      key: randomUUID(),
      // The real figure, which differs from what was expected.
      body: { billId: nextBill.id, amount: 140_000 },
    })
  ).data;
  eq('the credit lands with its real figure', `${credited.status} ${credited.creditedAmount}`, 'credited 140000');
  const billAfterRebate = (await api('GET', `/supplier-bills/${nextBill.id}`, { token: t })).data;
  eq('the bill owes less by the credit', billAfterRebate.balance, 500_000 - 140_000);
  eq('and says how much was rebated, apart from what was paid', `${billAfterRebate.rebated} ${billAfterRebate.paid}`, '140000 0');
  const profitAfter = (await api('GET', '/reports/profit?period=month', { token: t })).data;
  eq('profit shows it as vendor rebates in the month it landed', profitAfter.vendorRebates - profitBefore.vendorRebates, 140_000);
  eq(
    'adding it to what is left after expenses, not to gross profit',
    `${profitAfter.operatingProfit - profitBefore.operatingProfit} ${profitAfter.grossProfit - profitBefore.grossProfit}`,
    '140000 0',
  );
  eq(
    'and it is not a payment: Money out did not move',
    (await api('GET', `/supplier-payments?order=desc&limit=200`, { token: t })).data.payments.some((row) => row.billId === nextBill.id),
    false,
  );

  // A credit on the wrong bill is taken back: the bill owes again.
  await api('POST', `/vendor-rebates/${rebate.id}/uncredit`, { token: t });
  eq('removing the credit puts the bill back to owing', (await api('GET', `/supplier-bills/${nextBill.id}`, { token: t })).data.balance, 500_000);
  await api('POST', `/vendor-rebates/${rebate.id}/credit`, { token: t, key: randomUUID(), body: { billId: nextBill.id, amount: 140_000 } });
  eq(
    'the vendor statement lists the credit',
    (await api('GET', `/suppliers/${supplier.id}/statement`, { token: t })).data.totalRebated,
    140_000,
  );

  // What was bought this month, from the same receipts.
  const purchases = (await api('GET', '/reports/purchases?period=month', { token: t })).data;
  check('the purchases summary knows the month cost something', purchases.total > 0);
  check('across several deliveries', purchases.deliveries >= 2);
  check('broken down per vendor', purchases.bySupplier.length >= 1);
  check(
    'and it counts the free goods that arrived without being charged for',
    purchases.unitsFree > 0,
    `${purchases.unitsFree} base units`,
  );

  // Both halves reach the dashboard, which is owner-only already.
  const board = (await api('GET', '/reports/dashboard', { token: t })).data;
  eq(
    'the dashboard total matches the payables list exactly',
    board.purchasing.payables.total,
    (await api('GET', '/payables', { token: t })).data.total,
  );
  eq(
    'and the month purchases match the report',
    board.purchasing.purchases.month,
    purchases.total,
  );

  // A rep must never see any of it: this is buying-price data.
  await api('GET', '/payables', { token: bolaToken, expect: 403 });
  check('a rep cannot see what the business owes its vendors', true);
  await api('GET', '/reports/purchases?period=month', { token: bolaToken, expect: 403 });
  check('nor what it spent buying stock', true);

  step(42, 'Tenancy: a second organization sees none of this');
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
  const theirTiers = (await api('GET', '/price-tiers', { token: other.token })).data;
  eq('and its own two tiers', theirTiers.length, 2);
  check(
    "not the first org's Trade list",
    !theirTiers.some((x) => x.name === 'Trade'),
    theirTiers.map((x) => x.name).join(', '),
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
  // A fresh business opens the dashboard to zeros, not to another business's month.
  const theirDash = (await api('GET', '/reports/dashboard', { token: other.token })).data;
  eq('the dashboard shows a new business nothing sold', theirDash.sales.monthGross, 0);
  eq('nothing collected', theirDash.collections.month, 0);
  eq('and no stock to value', theirDash.attention.outOfStockCount, 0);
  eq(
    'and its stock valuation is empty rather than inherited',
    (await api('GET', '/reports/stock-valuation', { token: other.token })).data.total,
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
  const theirSale = (
    await api('POST', '/sales', {
      token: other.token,
      body: { lines: [{ productId: theirProduct.id, quantity: 1 }] },
    })
  ).data;
  eq('and its invoice numbering starts fresh at one', theirSale.number, 'INV-0001');
  // It never switched VAT on, so the product's 7.5% is not charged: the whole
  // price is the shop's, and the invoice will print no VAT line.
  eq('a shop that does not charge VAT records none', theirSale.taxTotal, 0);
  eq('and the price is unchanged', theirSale.total, 100_000);
  eq('down to the line', theirSale.lines[0].taxRateBps, 0);
  await api('GET', `/products/${product.id}`, { token: other.token, expect: 404 });
  check("fetching the other org's product by id is 404", true);
  await api('GET', `/sales/${credit.id}`, { token: other.token, expect: 404 });
  check("and neither is the other org's invoice", true);

  // The leak this suite failed to notice for six slices: GET /users/:id had no
  // guard and no tenancy filter, and returned the argon2 password hash to any
  // authenticated caller in any business.
  const viewer = (await api('GET', '/auth/me', { token: t })).data;
  const ownRecord = (await api('GET', `/users/${viewer.sub}`, { token: t })).data;
  check(
    'a user can read their own record',
    ownRecord.id === viewer.sub,
    JSON.stringify(Object.keys(ownRecord)),
  );
  for (const secret of ['password', 'otpHash', 'otpExpiresAt', 'lastLoginIp']) {
    check(`and it never carries ${secret}`, !(secret in ownRecord));
  }

  await api('GET', `/users/${viewer.sub}`, { token: other.token, expect: 404 });
  check('another organization cannot read that user at all', true);

  step(43, 'Sign-up: a shop creates itself with no email at all');

  // The path a real customer takes. It mints no verification code, so it has to
  // work on an instance with no mail provider — which is how this deploys.
  const shopSuffix = Date.now().toString(36).slice(-6);
  const shopUser = 'owner' + shopSuffix;
  const signUpBody = {
    organizationName: 'Self Serve ' + shopSuffix,
    firstName: 'Self',
    lastName: 'Serve',
    username: shopUser,
    password: 'correct-horse-battery',
  };

  const signedUp = await api('POST', '/auth/sign-up', { body: signUpBody, expect: [200, 201] });
  const selfToken = signedUp.data.accessToken;
  check('signing up returns a session immediately', typeof selfToken === 'string' && selfToken.length > 20);

  const selfMe = (await api('GET', '/auth/me', { token: selfToken })).data;
  eq('and the new member is an owner', selfMe.orgRole, 'owner');
  check('whose email claim is null, because they gave none', selfMe.email === null, JSON.stringify(selfMe.email));

  // The sharing with the CLI path is the point: a self-made shop must be
  // indistinguishable from one we made, or the accounts differ in ways that
  // only surface in front of a customer.
  const selfTiers = (await api('GET', '/price-tiers', { token: selfToken })).data;
  check('the new shop was seeded with a default price tier', Array.isArray(selfTiers) && selfTiers.length >= 1, JSON.stringify(selfTiers?.length));
  const selfLocations = (await api('GET', '/locations', { token: selfToken })).data;
  check('and somewhere to put stock', Array.isArray(selfLocations) && selfLocations.length >= 1);

  // Globally unique, and refused rather than silently suffixed.
  await api('POST', '/auth/sign-up', { body: { ...signUpBody, organizationName: 'Another Shop' }, expect: 409 });
  check('a username already taken is refused with a 409', true);

  // Signing in again with that username is deliberately *not* checked here.
  // Login allows five attempts a minute per address and the staff section
  // already spends them; a sixth at the end of the run fails with a 429 that
  // looks like a sign-up bug and is not one. The username login path is
  // covered there, by the cashiers who have no email either.

  step(44, 'Import: a catalog from a spreadsheet, previewed and then saved whole');

  // The fresh shop from step 43, so its catalog starts empty. Every cell is
  // text, exactly as the spreadsheet stored it.
  const peakRow = {
    line: 2, name: 'Peak 14g', size: '14g', category: 'Milk',
    countedIn: 'sachet', price: '100',
    units: [
      { name: 'roll', count: '10', price: '950' },
      { name: 'carton', count: '160', price: '14,500' },
    ],
    barcode: '4006381333931',
  };
  const goodRows = [peakRow, { line: 3, name: 'Indomie 70g', category: 'milk', price: 'N250' }];
  const badRow = { line: 4, name: 'Milo 500g', units: [{ name: 'carton', count: '0.5' }] };

  const preview = (
    await api('POST', '/products/import', {
      token: selfToken,
      key: randomUUID(),
      body: { rows: [...goodRows, badRow], dryRun: true },
    })
  ).data;
  eq('the preview adds the two good rows', preview.adding, 2);
  eq('and names the one with a problem', preview.rows[2].status, 'error');
  eq('one category, matched case aside', preview.newCategories.join(), 'Milk');
  eq('and saves nothing', (await api('GET', '/products', { token: selfToken })).data.length, 0);

  await api('POST', '/products/import', {
    token: selfToken,
    key: randomUUID(),
    body: { rows: [...goodRows, badRow] },
    expect: 400,
  });
  check('a save with a row still in error is refused', true);
  eq('and writes nothing at all', (await api('GET', '/products', { token: selfToken })).data.length, 0);

  const imported = (
    await api('POST', '/products/import', {
      token: selfToken,
      key: randomUUID(),
      body: { rows: goodRows },
    })
  ).data;
  eq('the good rows save', `${imported.saved} ${imported.adding}`, 'true 2');

  const selfProducts = (await api('GET', '/products', { token: selfToken })).data;
  const peakImported = selfProducts.find((p) => p.name === 'Peak 14g');
  eq('both are in the catalog', selfProducts.length, 2);
  eq(
    'with every unit and how many sachets it holds',
    peakImported.units.map((u) => `${u.name}:${u.factor}`).join(' '),
    'sachet:1 roll:10 carton:160',
  );
  eq('filed under the new category', peakImported.category?.name, 'Milk');
  const cartonPrice = (
    await api(
      'GET',
      `/products/${peakImported.id}/price?unitId=${peakImported.units.find((u) => u.name === 'carton').id}`,
      { token: selfToken },
    )
  ).data;
  eq('the carton has its own price on the default list', cartonPrice.price, 1_450_000);
  eq(
    'and the barcode scans to the sachet',
    (await api('GET', '/scan/4006381333931', { token: selfToken })).data.unit.name,
    'sachet',
  );

  const again = (
    await api('POST', '/products/import', {
      token: selfToken,
      key: randomUUID(),
      body: { rows: goodRows },
    })
  ).data;
  eq('importing the same file again skips every row', `${again.adding} ${again.skipped}`, '0 2');

  // A lotion carton of 12 sold only in halves and quarters: the carton has no
  // price, so it is counted and not sold; the portions are worked out from it.
  const lotion = (
    await api('POST', '/products/import', {
      token: selfToken,
      key: randomUUID(),
      body: {
        rows: [{
          line: 2, name: 'Even Glow 400ml', countedIn: 'piece',
          units: [
            { name: 'carton', count: '12' },
            { name: '1/2 carton', price: '29,900' },
            { name: '1/4 carton', price: '14,950' },
          ],
        }],
      },
    })
  ).data;
  eq('a carton sold only in parts imports', lotion.adding, 1);
  const glow = (await api('GET', '/products?search=Even%20Glow', { token: selfToken })).data[0];
  eq(
    'its portions are worked out, and only priced units are sold',
    glow.units.map((u) => `${u.name}:${u.factor}:${u.isSellable ? 'sold' : 'counted'}`).join(' '),
    'piece:1:counted 1/4 carton:3:sold 1/2 carton:6:sold carton:12:counted',
  );

  // A whole catalog in one request: past the default 100kb body, and saved in
  // a handful of statements rather than one round trip per product.
  const bigRows = Array.from({ length: 2000 }, (_, i) => ({
    line: i + 2, name: `Bulk item ${i}`, countedIn: 'piece', price: '100',
    units: [{ name: 'carton', count: '24', price: '2,300' }],
  }));
  const started = Date.now();
  const bulk = (
    await api('POST', '/products/import', { token: selfToken, key: randomUUID(), body: { rows: bigRows } })
  ).data;
  eq('two thousand rows import in one request', bulk.adding, 2000);
  console.log(`      2,000 products in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  step(45, 'Opening stock: what was on the shelf on day one, and what it cost');

  // The products just imported have never had stock come in, so the sheet
  // offers them — starting on the biggest unit, because shelves are counted
  // in cartons.
  const openingSheet = (await api('GET', '/stock/opening', { token: selfToken })).data;
  const peakLine = openingSheet.find((row) => row.id === peakImported.id);
  check('a product with no stock yet is on the opening sheet', !!peakLine);
  eq(
    'starting on its biggest unit',
    peakLine.units.find((u) => u.id === peakLine.defaultUnitId).name,
    'carton',
  );
  const unitIdOf = (name) => peakLine.units.find((u) => u.name === name).id;

  const openingBody = {
    lines: [
      // 14 cartons at ₦14,000, and 2½ rolls at ₦900 — a decimal in the
      // chosen unit, since it comes to whole sachets: two lots.
      { productId: peakImported.id, unitId: unitIdOf('carton'), quantity: 14, unitCost: 1_400_000, expiryDate: '2027-03-31' },
      { productId: peakImported.id, unitId: unitIdOf('roll'), quantity: 2.5, unitCost: 90_000 },
    ],
  };
  await api('POST', '/stock/opening', {
    token: selfToken,
    key: randomUUID(),
    body: { lines: [{ ...openingBody.lines[1], quantity: 2.25 }] },
    expect: 400,
  });
  check('2.25 rolls is refused — it is not a whole number of sachets — and nothing is saved', true);
  const opened = (
    await api('POST', '/stock/opening', { token: selfToken, key: randomUUID(), body: openingBody })
  ).data;
  eq('both lines are recorded for one product', `${opened.products} ${opened.lines}`, '1 2');
  eq('valued at cost × quantity, the decimal included', opened.totalValue, 14 * 1_400_000 + 225_000);

  eq(
    'stock is on the shelf, in sachets',
    (await onHand(selfToken, peakImported.id, selfLocations[0].id)).quantity,
    14 * 160 + 25,
  );
  eq(
    'and no bill was raised for goods paid for long ago',
    (await api('GET', '/payables', { token: selfToken })).data.total,
    0,
  );
  eq(
    'stock valuation reads the cost given',
    (await api('GET', '/reports/stock-valuation', { token: selfToken })).data.total,
    14 * 1_400_000 + 225_000,
  );
  check(
    'and the product leaves the opening sheet',
    !(await api('GET', '/stock/opening', { token: selfToken })).data.some((row) => row.id === peakImported.id),
  );

  await api('POST', '/stock/opening', { token: selfToken, key: randomUUID(), body: openingBody, expect: 409 });
  check('entering the same opening stock twice is refused, not doubled', true);

  // An opening lot entered at the wrong cost is put right — its value only.
  const peakLots = (
    await api('GET', `/stock/levels?productId=${peakImported.id}&includeBatches=true`, { token: selfToken })
  ).data.flatMap((row) => row.batches);
  const rollLot = peakLots.find((lot) => lot.isOpening && lot.quantity === 25);
  check('opening lots say they are opening stock', !!rollLot && peakLots.every((lot) => lot.isOpening));
  const valueBefore = (await api('GET', '/reports/stock-valuation', { token: selfToken })).data.total;
  const fix = { unitId: unitIdOf('roll'), unitCost: 100_000 };
  const costPreview = (
    await api('POST', `/stock/opening/lots/${rollLot.batchId}/cost/preview`, { token: selfToken, body: fix })
  ).data;
  eq(
    'a preview works out the new value — ₦1,000 a roll over 2½ rolls — and saves nothing',
    `${costPreview.totalCostBefore} ${costPreview.totalCostAfter} ${costPreview.saved}`,
    '225000 250000 false',
  );
  eq('so the stock value has not moved', (await api('GET', '/reports/stock-valuation', { token: selfToken })).data.total, valueBefore);
  await api('POST', `/stock/opening/lots/${rollLot.batchId}/cost`, { token: selfToken, key: randomUUID(), body: fix, expect: 400 });
  check('saving it needs a reason (400)', true);
  await api('POST', `/stock/opening/lots/${rollLot.batchId}/cost`, {
    token: selfToken,
    key: randomUUID(),
    body: { ...fix, reason: 'Entered at the old price.' },
  });
  eq(
    'saved, the stock value moves by exactly the difference',
    (await api('GET', '/reports/stock-valuation', { token: selfToken })).data.total,
    valueBefore + 25_000,
  );
  eq(
    'and the stock itself does not move',
    (await onHand(selfToken, peakImported.id, selfLocations[0].id)).quantity,
    14 * 160 + 25,
  );

  step(46, 'Correcting a delivery: 7 cartons recorded, 6½ arrived');

  // The owner's own mistake: 7 cartons entered, 6½ actually came, 6 of them
  // paid for. Here a carton is 24, so the truth is 156 received, 144 paid for.
  const wrong = (
    await api('POST', '/goods-receipts', {
      token: t,
      key: randomUUID(),
      body: {
        supplierId: supplier.id,
        locationId: main.id,
        invoiceNumber: 'DN-CORRECT',
        lines: [{ productId: product.id, unitId: carton.id, quantityReceived: 7, quantityPaidFor: 7, totalCost: 8_400_000 }],
      },
    })
  ).data;
  const billOfWrong = async () =>
    (await api('GET', `/supplier-bills?supplierId=${supplier.id}`, { token: t })).data.find(
      (bill) => bill.goodsReceiptId === wrong.id,
    );
  eq('the delivery raised its bill at the recorded value', (await billOfWrong()).amountDue, 8_400_000);
  const levelBeforeFix = await levelAt(t, product.id, main.id);

  // The preview is the real correction, run and rolled back.
  const fixPreview = (
    await api('POST', `/goods-receipts/${wrong.id}/corrections/preview`, {
      token: t,
      body: {
        reason: 'Miscounted: 6½ cartons came, 6 paid for.',
        lines: [{ lineId: wrong.lines[0].id, received: 156, paidFor: 144, totalCost: 7_200_000 }],
      },
    })
  ).data;
  eq(
    'the preview says what would move',
    `${fixPreview.lines[0].stockDelta} ${fixPreview.valueDelta} ${fixPreview.billAmountBefore} ${fixPreview.billAmountAfter}`,
    '-12 -1200000 8400000 7200000',
  );
  eq('and moves nothing', await levelAt(t, product.id, main.id), levelBeforeFix);
  eq('not even the bill', (await billOfWrong()).amountDue, 8_400_000);

  const corrected = (
    await api('POST', `/goods-receipts/${wrong.id}/corrections`, {
      token: t,
      key: randomUUID(),
      body: {
        reason: 'Miscounted: 6½ cartons came, 6 paid for.',
        lines: [{ lineId: wrong.lines[0].id, received: 156, paidFor: 144, totalCost: 7_200_000 }],
      },
    })
  ).data;
  eq('the line now says what arrived, in pieces since 6½ cartons is not whole', `${corrected.lines[0].quantityReceived} ${corrected.lines[0].quantityReceivedInUnit} ${corrected.lines[0].unit.factor}`, '156 156 1');
  eq('the half carton that never came left the stock', await levelAt(t, product.id, main.id), levelBeforeFix - 12);
  eq('the bill moved with the value', (await billOfWrong()).amountDue, 7_200_000);
  eq(
    'and the figures before are kept, with the reason',
    `${corrected.corrections.length} ${corrected.corrections[0].lines[0].receivedBefore} ${corrected.corrections[0].reason}`,
    '1 168 Miscounted: 6½ cartons came, 6 paid for.',
  );

  // It could be the other way round later — and it can be corrected again.
  const putBack = (
    await api('POST', `/goods-receipts/${wrong.id}/corrections`, {
      token: t,
      key: randomUUID(),
      body: {
        reason: 'The other half carton was found in the van.',
        lines: [{ lineId: wrong.lines[0].id, received: 168, paidFor: 168, totalCost: 8_400_000 }],
      },
    })
  ).data;
  eq('a delivery can be corrected again, in either direction', await levelAt(t, product.id, main.id), levelBeforeFix);
  eq('back in whole cartons', `${putBack.lines[0].quantityReceivedInUnit} ${putBack.lines[0].unit.factor}`, '7 24');
  eq('with both corrections in its history', putBack.corrections.length, 2);
  eq('and the bill back where it was', (await billOfWrong()).amountDue, 8_400_000);

  await api('POST', `/goods-receipts/${wrong.id}/corrections`, {
    token: t,
    key: randomUUID(),
    body: { reason: 'Nothing really', lines: [{ lineId: wrong.lines[0].id, received: 168, paidFor: 168, totalCost: 8_400_000 }] },
    expect: 400,
  });
  check('a correction that changes nothing is refused', true);

  // The ledger is still only added to, and still adds up to the levels. Read
  // newest first, as a person browses: the forward walk a phone syncs with
  // holds back the last second, which is exactly when these were written.
  let moves = [];
  for (let cursor = null, guard = 0; guard < 50; guard++) {
    const page = (
      await api('GET', `/stock/movements?productId=${product.id}&order=desc&limit=500${cursor ? `&cursor=${cursor}` : ''}`, { token: t })
    ).data;
    moves = moves.concat(page.movements);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const productLevels = (await api('GET', `/stock/levels?productId=${product.id}&includeEmpty=true`, { token: t })).data;
  eq(
    'after both corrections the ledger still sums to the levels',
    moves.reduce((sum, m) => sum + m.quantity, 0),
    productLevels.reduce((sum, row) => sum + row.quantity, 0),
  );
  check(
    'the corrections are movements of their own, never edits',
    moves.filter((m) => m.reason === 'receipt_correction').length === 2,
  );

  step(47, 'Pay later: due in five days, and on everyone’s reminder');

  // In the shop from step 43, which has stock from step 45. A customer takes
  // goods "six days ago" and pays later, so the invoice is a day overdue.
  const lateCustomer = (
    await api('POST', '/customers', {
      token: selfToken,
      body: { id: randomUUID(), firstName: 'Late', lastName: 'Payer', phone: '08030000000' },
    })
  ).data;
  const madeSixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const laterSale = (
    await api('POST', '/sales', {
      token: selfToken,
      key: randomUUID(),
      body: {
        customerId: lateCustomer.id,
        occurredAt: madeSixDaysAgo,
        lines: [{ productId: peakImported.id, quantity: 1 }],
        payment: { amount: 0, method: 'cash' },
      },
    })
  ).data;
  check('a sale on credit gets a due date', !!laterSale.dueDate);
  const daysUntilDue = Math.round(
    (new Date(laterSale.dueDate).getTime() - new Date(madeSixDaysAgo).getTime()) / 86_400_000,
  );
  check('five days after the sale', daysUntilDue >= 4 && daysUntilDue <= 5, `${daysUntilDue} days`);

  const dueNow = (await api('GET', '/sales/due', { token: selfToken })).data;
  const ourDue = dueNow.invoices.find((row) => row.saleId === laterSale.id);
  eq('it is on the reminder, a day overdue', ourDue?.daysPastDue, 1);
  eq('with who to ask and what they owe', `${ourDue?.customer.name} ${ourDue?.customer.phone} ${ourDue?.balance}`, `Late Payer 08030000000 ${laterSale.total}`);
  check('and counted as overdue', dueNow.overdue >= 1);

  await api('GET', '/sales/due', { token: bolaToken });
  check('a cashier can read the reminder — they are the ones who ask', true);

  // The same date reaches the unpaid list, the statement and the invoice.
  const owedList = (
    await api('GET', `/receivables?customerId=${lateCustomer.id}`, { token: selfToken })
  ).data;
  const owedRow = owedList.invoices.find((row) => row.id === laterSale.id);
  eq('the unpaid list carries the due date', owedRow?.dueDate, laterSale.dueDate);
  eq('and how late it is, the same count as the reminder', owedRow?.daysPastDue, 1);
  const lateReceipt = (await api('GET', `/sales/${laterSale.id}/receipt`, { token: selfToken })).data;
  eq('the receipt the invoice prints from says when it is due', lateReceipt.dueDate, laterSale.dueDate);

  await api('POST', '/payments', {
    token: selfToken,
    key: randomUUID(),
    body: {
      id: randomUUID(),
      customerId: lateCustomer.id,
      amount: laterSale.total,
      method: 'cash',
      allocations: [{ saleId: laterSale.id, amount: laterSale.total }],
    },
  });
  check(
    'once paid, it leaves the reminder',
    !(await api('GET', '/sales/due', { token: selfToken })).data.invoices.some((row) => row.saleId === laterSale.id),
  );
  eq(
    'and a paid invoice prints no due date',
    (await api('GET', `/sales/${laterSale.id}/receipt`, { token: selfToken })).data.dueDate,
    null,
  );

  step(48, 'Currency: chosen at sign-up, changeable only until money is recorded');

  const nairaShop = (await api('GET', '/organization', { token: selfToken })).data;
  eq('a shop that never chose is in naira, on Lagos time', `${nairaShop.currency} ${nairaShop.timezone}`, 'NGN Africa/Lagos');
  check('and with sales on it, its currency is locked', nairaShop.currencyLocked === true);
  await api('PATCH', '/organization', { token: selfToken, body: { currency: 'USD' }, expect: 409 });
  check('so changing it is refused (409) — every figure would be relabelled', true);

  const cediShop = await api('POST', '/auth/sign-up', {
    body: {
      organizationName: `Accra Mart ${shopSuffix}`,
      firstName: 'Kofi',
      lastName: 'Mensah',
      username: `kofi${shopSuffix}`,
      password: 'correct-horse-battery',
      currency: 'GHS',
    },
    expect: [200, 201],
  });
  const cediToken = cediShop.data.accessToken;
  const cedis = (await api('GET', '/organization', { token: cediToken })).data;
  eq('a shop signed up in cedis keeps cedis, on Accra time', `${cedis.currency} ${cedis.timezone}`, 'GHS Africa/Accra');
  check('and, empty, is not locked yet', cedis.currencyLocked === false);

  const currencyFix = (
    await api('PATCH', '/organization', {
      token: cediToken,
      body: { currency: 'KES', timezone: 'Africa/Nairobi' },
    })
  ).data;
  eq('a wrong choice is put right before anything is priced', `${currencyFix.currency} ${currencyFix.timezone}`, 'KES Africa/Nairobi');
  await api('PATCH', '/organization', { token: cediToken, body: { timezone: 'Nairobi' }, expect: 400 });
  check('a time zone the server does not know is refused (400)', true);
  await api('PATCH', '/organization', { token: cediToken, body: { currency: 'XOF' }, expect: 400 });
  check('and so is a currency Reho does not keep books in (400)', true);

  await api('POST', '/products', {
    token: cediToken,
    body: { name: 'Milo 400g', basePrice: 4_500, units: [{ name: 'tin', factor: 1 }] },
  });
  check('the first price locks it', (await api('GET', '/organization', { token: cediToken })).data.currencyLocked === true);
  await api('PATCH', '/organization', { token: cediToken, body: { currency: 'NGN' }, expect: 409 });
  check('after which changing it is refused (409)', true);
  await api('PATCH', '/organization', { token: cediToken, body: { currency: 'KES', name: `Nairobi Mart ${shopSuffix}` } });
  check('while sending the same currency back with other changes still saves', true);

  step(49, 'Salaries: their own screen and their own profit line, still an expense');

  const salariesCategory = (await api('GET', '/expense-categories', { token: t })).data.find(
    (c) => c.isSalaries,
  );
  check('every shop has one salaries category', !!salariesCategory, '');
  const profitBeforePay = (await api('GET', '/reports/profit?period=today', { token: t })).data;

  const pay = (
    await api('POST', '/expenses', {
      token: t,
      key: randomUUID(),
      body: {
        categoryId: salariesCategory.id,
        amount: 4_500_000,
        method: 'transfer',
        paidTo: 'Amina Bello',
        note: 'September',
      },
    })
  ).data;
  check('a salary is recorded like any expense', pay.category.isSalaries === true);

  const salaryList = (await api('GET', '/expenses?kind=salaries', { token: t })).data;
  check('the Salaries screen lists it', salaryList.expenses.some((e) => e.id === pay.id));
  const otherList = (await api('GET', '/expenses?kind=other', { token: t })).data;
  check('and the Expenses screen does not', !otherList.expenses.some((e) => e.id === pay.id));
  check(
    'whose total leaves salaries out',
    otherList.expenses.every((e) => !e.category.isSalaries),
  );
  await api('GET', '/expenses?kind=bonuses', { token: t, expect: 400 });
  check('an unknown kind is refused (400)', true);

  const profitAfterPay = (await api('GET', '/reports/profit?period=today', { token: t })).data;
  eq('profit shows salaries on their own line', profitAfterPay.salaries - profitBeforePay.salaries, 4_500_000);
  eq('other expenses are untouched by it', profitAfterPay.otherExpenses, profitBeforePay.otherExpenses);
  eq('and the two add up to expenses', profitAfterPay.expenses, profitAfterPay.salaries + profitAfterPay.otherExpenses);
  eq(
    'still taken off profit — wages paid are not money made',
    profitBeforePay.operatingProfit - profitAfterPay.operatingProfit,
    4_500_000,
  );

  await api('DELETE', `/expense-categories/${salariesCategory.id}`, { token: t, expect: 409 });
  check('the salaries category cannot be removed (409)', true);

  step(50, 'Margins: today’s price beside what the stock on hand cost');

  const soap = (
    await api('POST', '/products', {
      token: t,
      body: {
        name: `Margin Soap ${shopSuffix}`,
        basePrice: 1_000, // ₦10 a piece, from the fallback
        taxRateBps: 750,
        units: [
          { name: 'piece', factor: 1, isDefaultSelling: true, isSellable: true },
          { name: 'carton', factor: 12, isSellable: true },
        ],
        prices: [{ unit: 'carton', tierId: tier.id, price: 10_750 }],
      },
    })
  ).data;
  const soapCarton = soap.units.find((u) => u.name === 'carton');
  const marginsFor = async () =>
    (await api('GET', `/reports/margins?tierId=${tier.id}`, { token: t })).data;
  const rowOf = (view, unitName) =>
    view.rows.find((r) => r.productId === soap.id && r.unitName === unitName);

  let margins = await marginsFor();
  const unstocked = rowOf(margins, 'carton');
  check(
    'with no delivery yet there is no cost and no margin — never a zero',
    unstocked && unstocked.cost === null && unstocked.margin === null && unstocked.price === 10_750,
    JSON.stringify(unstocked),
  );

  // Buy 12 get 1 free: 13 cartons on an invoice for 12 at ₦90.
  await api('POST', '/goods-receipts', {
    token: t,
    key: randomUUID(),
    body: {
      supplierId: supplier.id,
      locationId: main.id,
      invoiceNumber: `PROMO-${shopSuffix}`,
      lines: [
        {
          productId: soap.id,
          unitId: soapCarton.id,
          quantityReceived: 13,
          quantityPaidFor: 12,
          totalCost: 108_000,
        },
      ],
    },
  });

  margins = await marginsFor();
  const cartonRow = rowOf(margins, 'carton');
  // ₦1,080 over 156 pieces, times 12, rounded once: ₦83.08 a carton, not ₦90.
  eq('the free carton makes every carton cheaper', cartonRow.cost, 8_308);
  eq('measured against the stock on hand', cartonRow.costFrom, 'on_hand');
  const netCarton = margins.chargesVat ? 10_000 : 10_750;
  eq('the margin is the price without VAT, less the cost', cartonRow.margin, netCarton - 8_308);
  eq(
    'and as a share of that price',
    cartonRow.marginBps,
    Math.round(((netCarton - 8_308) / netCarton) * 10_000),
  );
  eq('the deal is said the way a vendor says it', JSON.stringify(cartonRow.lastDelivery?.deal), '{"received":13,"paidFor":12}');
  check(
    'one row per product, in the biggest unit the till sells',
    margins.rows.filter((r) => r.productId === soap.id).map((r) => r.unitName).join() === 'carton',
  );
  check(
    'rows with a margin come before rows without one',
    margins.rows.findIndex((r) => r.marginBps === null) === -1 ||
      margins.rows.findIndex((r) => r.marginBps === null) >
        margins.rows.findLastIndex((r) => r.marginBps !== null),
  );

  await api('GET', '/reports/margins', { token: bolaToken, expect: 403 });
  check('buying prices stay closed to a cashier (403)', true);

  // A delivered lot is corrected through its delivery, never here.
  const soapLot = (
    await api('GET', `/stock/levels?productId=${soap.id}&includeBatches=true`, { token: t })
  ).data[0].batches[0];
  check('a delivered lot is not opening stock', soapLot.isOpening === false);
  await api('POST', `/stock/opening/lots/${soapLot.batchId}/cost`, {
    token: t,
    key: randomUUID(),
    body: { unitId: soapCarton.id, unitCost: 1, reason: 'Trying the wrong door.' },
    expect: 409,
  });
  check('and its cost cannot be changed as if it were (409)', true);
  await api('POST', `/stock/opening/lots/${soapLot.batchId}/cost/preview`, {
    token: bolaToken,
    body: { unitId: soapCarton.id, unitCost: 1 },
    expect: 403,
  });
  check('nor by a cashier (403)', true);

  // The products list shows cost in the unit it is sold in.
  const soapAsOwner = (await api('GET', `/products/${soap.id}`, { token: t })).data;
  eq(
    'a product carries what one carton cost on the last delivery — from the lot, not piece × 12',
    soapAsOwner.unitCosts?.find((u) => u.unitId === soapCarton.id)?.cost,
    8_308,
  );
  // The unit the till picks first, priced as the till prices it — for everybody.
  eq(
    'a product names the unit the till picks first, at the till’s price',
    `${soapAsOwner.tillUnit?.unitName} ${soapAsOwner.tillUnit?.price}`,
    'piece 1000',
  );
  const soapAsCashier = (await api('GET', `/products/${soap.id}`, { token: bolaToken })).data;
  eq('a cashier sees the same price', soapAsCashier.tillUnit?.price, 1_000);
  check('and a cashier is not sent it at all', !('unitCosts' in soapAsCashier) && !('costPrice' in soapAsCashier));

  // The catch-all: no response anywhere in this run may contain an argon2 hash.
  check(
    'no response in this run leaked a password hash',
    !seenHash,
    seenHash ?? '',
  );

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
