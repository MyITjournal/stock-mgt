import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { StockService } from '../inventory/stock.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  ProductService,
  assertExactlyOneBaseUnit,
  generateSku,
  settleAttributes,
} from './product.service';

describe('assertExactlyOneBaseUnit', () => {
  it('accepts a piece/pack/carton hierarchy with one base', () => {
    expect(() =>
      assertExactlyOneBaseUnit([
        { name: 'piece', factor: 1 },
        { name: 'pack', factor: 12 },
        { name: 'carton', factor: 24 },
      ]),
    ).not.toThrow();
  });

  it('rejects a product with no base unit', () => {
    // Without a factor-1 unit there is nothing to count stock in, so the
    // Slice 3 ledger would have no anchor.
    expect(() =>
      assertExactlyOneBaseUnit([
        { name: 'pack', factor: 12 },
        { name: 'carton', factor: 24 },
      ]),
    ).toThrow(BadRequestException);
  });

  it('rejects two units both claiming to be the base', () => {
    expect(() =>
      assertExactlyOneBaseUnit([
        { name: 'piece', factor: 1 },
        { name: 'sachet', factor: 1 },
      ]),
    ).toThrow(/Only one unit may have factor 1/);
  });

  it('rejects duplicate unit names regardless of case', () => {
    expect(() =>
      assertExactlyOneBaseUnit([
        { name: 'piece', factor: 1 },
        { name: 'Piece', factor: 12 },
      ]),
    ).toThrow(/unique/i);
  });

  it('accepts a single-unit product', () => {
    expect(() =>
      assertExactlyOneBaseUnit([{ name: 'piece', factor: 1 }]),
    ).not.toThrow();
  });
});

describe('generateSku', () => {
  it('derives a SKU from the product name', () => {
    expect(generateSku('Peak Milk 400g')).toBe('PEAK-MILK-400G');
  });

  it('collapses punctuation and trims separators', () => {
    expect(generateSku('  Indomie (Chicken) — 70g  ')).toBe(
      'INDOMIE-CHICKEN-70G',
    );
  });

  it('falls back when the name has nothing usable', () => {
    expect(generateSku('!!!')).toBe('PRODUCT');
  });

  it('caps the length', () => {
    expect(generateSku('a'.repeat(100)).length).toBeLessThanOrEqual(48);
  });
});

describe('ProductService packaging types', () => {
  let service: ProductService;
  let prisma: {
    product: {
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    packagingType: { findFirst: jest.Mock };
    priceTier: { findFirst: jest.Mock };
    productPrice: { updateMany: jest.Mock; create: jest.Mock };
    productBarcode: { create: jest.Mock };
    productUnit: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    organization: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      product: {
        // Units come back with ids because that is what create asks for: the
        // inline prices and barcodes are keyed by name and have to be mapped
        // onto the ids the same statement just minted.
        create: jest.fn().mockResolvedValue({
          id: 'prod-1',
          units: [
            { id: 'unit-piece', name: 'piece' },
            { id: 'unit-carton', name: 'carton' },
            { id: 'unit-pouch', name: 'pouch' },
            { id: 'unit-each', name: 'each' },
          ],
        }),
        update: jest.fn().mockResolvedValue({ id: 'prod-1' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'prod-1', units: [] }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      packagingType: { findFirst: jest.fn().mockResolvedValue(null) },
      priceTier: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tier-retail' }),
      },
      productPrice: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      productBarcode: { create: jest.fn().mockResolvedValue({}) },
      productUnit: {
        updateMany: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'unit-carton', name: 'carton', factor: 24, isSellable: true },
          ]),
      },
      organization: {
        findFirst: jest.fn().mockResolvedValue({ businessType: 'mixed' }),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: TENANT_PRISMA, useValue: prisma },
        { provide: StockService, useValue: { moveIntoVariant: jest.fn() } },
        // Nothing in this suite uploads; the service only needs the collaborator
        // to exist. The image path is covered against a running server instead,
        // where the interesting behaviour (an unconfigured CDN) actually lives.
        {
          provide: CloudinaryService,
          useValue: {
            isConfigured: false,
            assertConfigured: jest.fn(),
            uploadImage: jest.fn(),
            deleteImage: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ProductService);
  });

  const asOrg = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: 'org-aaa' }, fn);

  it('filters the catalog to one packaging form', async () => {
    // "Show me everything in pouches" is the point of the lookup table.
    await service.findAll({ packagingTypeId: 'pkg-pouch' });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          packagingTypeId: 'pkg-pouch',
        }) as object,
      }),
    );
  });

  it('leaves the filter off entirely when none was asked for', async () => {
    await service.findAll({});

    const [args] = prisma.product.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).not.toHaveProperty('packagingTypeId');
  });

  it('rejects a packaging type that is deleted or from another org', async () => {
    // findFirst already returns null for both cases: the service filters
    // deletedAt, and the tenant extension filters the organization.
    await expect(
      asOrg(() =>
        service.create({
          name: 'Milo 400g',
          basePrice: 350000,
          packagingTypeId: 'someone-elses',
          units: [{ name: 'pouch', factor: 1 }],
        }),
      ),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('stores the packaging type on the product', async () => {
    prisma.packagingType.findFirst.mockResolvedValue({ id: 'pkg-pouch' });

    await asOrg(() =>
      service.create({
        name: 'Milo 400g',
        basePrice: 350000,
        packagingTypeId: 'pkg-pouch',
        units: [{ name: 'pouch', factor: 1 }],
      }),
    );

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          packagingTypeId: 'pkg-pouch',
        }) as object,
      }),
    );
  });

  it('stores null when the product has no packaging type', async () => {
    await asOrg(() =>
      service.create({
        name: 'Delivery fee',
        basePrice: 100000,
        units: [{ name: 'each', factor: 1 }],
      }),
    );

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ packagingTypeId: null }) as object,
      }),
    );
  });

  describe('size', () => {
    const created = () =>
      (prisma.product.create.mock.calls[0] as [{ data: { size: unknown } }])[0]
        .data.size;
    const updated = () =>
      (prisma.product.update.mock.calls[0] as [{ data: object }])[0].data;

    it('stores the size, trimmed', async () => {
      await asOrg(() =>
        service.create({
          name: 'Peak Milk',
          size: ' 400g ',
          basePrice: 350000,
          units: [{ name: 'tin', factor: 1 }],
        }),
      );
      expect(created()).toBe('400g');
    });

    it('stores null for a blank or missing size, never an empty string', async () => {
      await asOrg(() =>
        service.create({
          name: 'Peak Milk',
          size: '   ',
          basePrice: 350000,
          units: [{ name: 'tin', factor: 1 }],
        }),
      );
      expect(created()).toBeNull();
    });

    it('clears the size on an update that sends an empty string', async () => {
      await asOrg(() => service.update('prod-1', { size: '' }));
      expect(updated()).toEqual(expect.objectContaining({ size: null }));
    });

    it('leaves the size alone on an update that does not mention it', async () => {
      await asOrg(() => service.update('prod-1', { name: 'Peak Milk Tin' }));
      expect(updated()).not.toHaveProperty('size');
    });

    it('finds products by size as well as name and SKU', async () => {
      await service.findAll({ search: '400g' });

      const [args] = prisma.product.findMany.mock.calls[0] as [
        { where: { OR: object[] } },
      ];
      expect(args.where.OR).toContainEqual({
        size: { contains: '400g', mode: 'insensitive' },
      });
    });
  });
});

describe('ProductService inline prices and barcodes', () => {
  let service: ProductService;
  let prisma: {
    product: {
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    packagingType: { findFirst: jest.Mock };
    priceTier: { findFirst: jest.Mock };
    productPrice: { updateMany: jest.Mock; create: jest.Mock };
    productBarcode: { create: jest.Mock };
    productUnit: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    organization: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };

  const UNITS = [
    { id: 'unit-piece', name: 'piece', factor: 1, isSellable: true },
    { id: 'unit-carton', name: 'carton', factor: 24, isSellable: true },
  ];

  beforeEach(async () => {
    prisma = {
      product: {
        create: jest.fn().mockResolvedValue({ id: 'prod-1', units: UNITS }),
        update: jest.fn().mockResolvedValue({ id: 'prod-1' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'prod-1', units: UNITS }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      packagingType: { findFirst: jest.fn().mockResolvedValue(null) },
      priceTier: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tier-retail' }),
      },
      productPrice: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      productBarcode: { create: jest.fn().mockResolvedValue({}) },
      productUnit: {
        findMany: jest.fn().mockResolvedValue(UNITS),
        updateMany: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      organization: {
        findFirst: jest.fn().mockResolvedValue({ businessType: 'mixed' }),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: TENANT_PRISMA, useValue: prisma },
        { provide: StockService, useValue: { moveIntoVariant: jest.fn() } },
        {
          provide: CloudinaryService,
          useValue: {
            isConfigured: false,
            assertConfigured: jest.fn(),
            uploadImage: jest.fn(),
            deleteImage: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ProductService);
  });

  const asOrg = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: 'org-aaa' }, fn);

  const milo = {
    name: 'Milo Refill 400g',
    basePrice: 250000,
    units: [
      { name: 'piece', factor: 1, isDefaultSelling: true },
      { name: 'carton', factor: 24 },
    ],
  };

  it('prices a unit named in the same request', async () => {
    // The whole point: at create time the caller has no unit ids, because the
    // units are being created by this very statement.
    await asOrg(() =>
      service.create({
        ...milo,
        prices: [{ unit: 'carton', price: 5400000 }],
      }),
    );

    expect(prisma.productPrice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitId: 'unit-carton',
          tierId: 'tier-retail',
          // The product's own price, not an option's (§24).
          variantId: null,
          price: 5400000,
        }) as object,
      }),
    );
  });

  it('falls back to the default tier only when none was named', async () => {
    await asOrg(() =>
      service.create({
        ...milo,
        prices: [{ unit: 'carton', tierId: 'tier-wholesale', price: 5000000 }],
      }),
    );

    expect(prisma.priceTier.findFirst).not.toHaveBeenCalled();
    expect(prisma.productPrice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tierId: 'tier-wholesale' }) as object,
      }),
    );
  });

  it('refuses a price for a unit that does not exist', async () => {
    await expect(
      asOrg(() =>
        service.create({ ...milo, prices: [{ unit: 'crate', price: 100 }] }),
      ),
    ).rejects.toThrow(/No unit named "crate"/);
  });

  it('attaches a barcode to the named unit', async () => {
    await asOrg(() =>
      service.create({
        ...milo,
        barcodes: [{ unit: 'carton', code: '5901234123457' }],
      }),
    );

    expect(prisma.productBarcode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitId: 'unit-carton',
          code: '5901234123457',
        }) as object,
      }),
    );
  });

  it('rejects a bad check digit before writing anything', async () => {
    // Validated outside the transaction, so a typo on one line does not roll
    // back a product that was otherwise fine.
    await expect(
      asOrg(() =>
        service.create({
          ...milo,
          barcodes: [{ unit: 'carton', code: '5901234123456' }],
        }),
      ),
    ).rejects.toThrow(/check digit/);

    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('mints an internal code when none is supplied', async () => {
    await asOrg(() =>
      service.create({ ...milo, barcodes: [{ unit: 'piece' }] }),
    );

    const calls = prisma.productBarcode.create.mock.calls as [
      { data: { code: string } },
    ][];
    expect(calls[0][0].data.code).toMatch(/^2\d{12}$/);
  });

  it('writes nothing extra when neither array is sent', async () => {
    await asOrg(() => service.create(milo));

    expect(prisma.productPrice.updateMany).not.toHaveBeenCalled();
    expect(prisma.productPrice.create).not.toHaveBeenCalled();
    expect(prisma.productBarcode.create).not.toHaveBeenCalled();
    expect(prisma.priceTier.findFirst).not.toHaveBeenCalled();
  });

  it('upserts on update without touching unlisted prices', async () => {
    // The trap: replacing the set would let a PATCH naming one unit silently
    // delete the price of every other.
    prisma.productPrice.updateMany.mockResolvedValue({ count: 1 });
    await asOrg(() =>
      service.update('prod-1', {
        prices: [{ unit: 'carton', price: 5600000 }],
      }),
    );

    // Update-then-create, since the key is a pair of partial indexes (§24) —
    // and the option is in the where as null, so an option's own price for
    // the carton is not overwritten with the product's.
    expect(prisma.productPrice.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.productPrice.updateMany).toHaveBeenCalledWith({
      where: {
        productId: 'prod-1',
        tierId: 'tier-retail',
        unitId: 'unit-carton',
        variantId: null,
      },
      data: { price: 5600000 },
    });
    expect(prisma.productPrice.create).not.toHaveBeenCalled();
  });
});

describe('ProductService editing units', () => {
  let service: ProductService;
  let prisma: {
    product: { update: jest.Mock; findFirst: jest.Mock };
    priceTier: { findFirst: jest.Mock };
    productPrice: { updateMany: jest.Mock; create: jest.Mock };
    productBarcode: { create: jest.Mock };
    productUnit: {
      findMany: jest.Mock;
      upsert: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    organization: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };

  /** What the product already has: a base piece and a carton of twelve. */
  const EXISTING = [
    {
      id: 'unit-piece',
      name: 'piece',
      factor: 1,
      isBase: true,
      isSellable: true,
    },
    {
      id: 'unit-carton',
      name: 'carton',
      factor: 12,
      isBase: false,
      isSellable: true,
    },
  ];

  beforeEach(async () => {
    prisma = {
      product: {
        update: jest.fn().mockResolvedValue({ id: 'prod-1' }),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'prod-1', units: EXISTING }),
      },
      priceTier: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tier-retail' }),
      },
      productPrice: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      productBarcode: { create: jest.fn().mockResolvedValue({}) },
      productUnit: {
        findMany: jest.fn().mockResolvedValue(EXISTING),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      organization: {
        findFirst: jest.fn().mockResolvedValue({ businessType: 'mixed' }),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: TENANT_PRISMA, useValue: prisma },
        { provide: StockService, useValue: { moveIntoVariant: jest.fn() } },
        {
          provide: CloudinaryService,
          useValue: {
            isConfigured: false,
            assertConfigured: jest.fn(),
            uploadImage: jest.fn(),
            deleteImage: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ProductService);
  });

  const asOrg = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: 'org-aaa' }, fn);

  /**
   * The bug this replaced: `PATCH /products/:id` took a `units` array,
   * validated it, wrote nothing, and answered 200.
   */
  it('adds a unit a shop has started selling', async () => {
    await asOrg(() =>
      service.update('prod-1', { units: [{ name: 'dozen', factor: 12 }] }),
    );

    expect(prisma.productUnit.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.productUnit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          name: 'dozen',
          factor: 12,
        }) as object,
      }),
    );
  });

  it('leaves units it does not mention alone', async () => {
    await asOrg(() =>
      service.update('prod-1', { units: [{ name: 'carton', factor: 24 }] }),
    );

    // One call, for the carton. The piece is untouched — replacing the set
    // would orphan every movement and sale line pointing at it.
    expect(prisma.productUnit.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.productUnit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ factor: 24 }) as object,
      }),
    );
  });

  /**
   * The base-unit rule is checked against the merged result, not the request.
   * A PATCH that adds a carton lists no base at all and must still be allowed.
   */
  it('accepts a change that names no base unit, because one already exists', async () => {
    await expect(
      asOrg(() =>
        service.update('prod-1', { units: [{ name: 'pallet', factor: 480 }] }),
      ),
    ).resolves.toBeDefined();
  });

  it('refuses a second base unit', async () => {
    await expect(
      asOrg(() =>
        service.update('prod-1', { units: [{ name: 'sachet', factor: 1 }] }),
      ),
    ).rejects.toThrow(/base units/i);
  });

  /**
   * Stock is recorded in base units, so promoting the carton would silently
   * reinterpret every quantity already in the ledger.
   */
  it('refuses to swap which unit is the base', async () => {
    // Demoting the piece and promoting the carton keeps exactly one base, so
    // the merged-set check passes and the per-unit guard is what catches it.
    // It has to: stock is recorded in base units, so this would silently
    // reinterpret every quantity already in the ledger as cartons.
    await expect(
      asOrg(() =>
        service.update('prod-1', {
          units: [
            { name: 'piece', factor: 12 },
            { name: 'carton', factor: 1 },
          ],
        }),
      ),
    ).rejects.toThrow(/cannot change/i);
  });

  it('refuses to demote the base unit, which would leave none', async () => {
    await expect(
      asOrg(() =>
        service.update('prod-1', { units: [{ name: 'piece', factor: 6 }] }),
      ),
    ).rejects.toThrow(/no base unit/i);
  });
});

describe('ProductService tillSearch', () => {
  let service: ProductService;
  let prisma: {
    product: { findMany: jest.Mock };
    priceTier: { findFirst: jest.Mock };
  };

  /** Peak 14g at a distributor: sachets counted, never sold. */
  const PEAK = {
    id: 'peak',
    name: 'Peak 14g',
    size: '14g',
    sku: 'PEAK-14G',
    trackStock: true,
    taxRateBps: 750,
    basePrice: null,
    units: [
      {
        id: 'u-sachet',
        name: 'sachet',
        factor: 1,
        isSellable: false,
        isDefaultSelling: false,
      },
      {
        id: 'u-roll',
        name: 'roll',
        factor: 10,
        isSellable: true,
        isDefaultSelling: false,
      },
      {
        id: 'u-carton',
        name: 'carton',
        factor: 210,
        isSellable: true,
        isDefaultSelling: true,
      },
    ],
    prices: [
      { tierId: 'tier-wholesale', unitId: 'u-carton', price: 4_000_000 },
    ],
    variants: [] as { id: string; name: string }[],
  };

  /** Eva soap: three options at one price, Gold with a carton price of its own. */
  const EVA = {
    id: 'eva',
    name: 'Eva Soap',
    size: '150g',
    sku: 'EVA-150G',
    trackStock: true,
    taxRateBps: 0,
    basePrice: 50_000,
    units: [
      {
        id: 'u-piece',
        name: 'piece',
        factor: 1,
        isSellable: true,
        isDefaultSelling: true,
      },
      {
        id: 'u-eva-carton',
        name: 'carton',
        factor: 24,
        isSellable: true,
        isDefaultSelling: false,
      },
    ],
    prices: [
      {
        tierId: 'tier-wholesale',
        unitId: 'u-eva-carton',
        variantId: null,
        price: 1_100_000,
      },
      {
        tierId: 'tier-wholesale',
        unitId: 'u-eva-carton',
        variantId: 'v-gold',
        price: 1_300_000,
      },
    ],
    variants: [
      { id: 'v-classic', name: 'Classic' },
      { id: 'v-gold', name: 'Gold' },
      { id: 'v-moringa', name: 'Moringa' },
    ],
  };

  beforeEach(async () => {
    prisma = {
      product: { findMany: jest.fn().mockResolvedValue([PEAK]) },
      priceTier: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tier-wholesale' }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: TENANT_PRISMA, useValue: prisma },
        { provide: StockService, useValue: { moveIntoVariant: jest.fn() } },
        {
          provide: CloudinaryService,
          useValue: { isConfigured: false, assertConfigured: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(ProductService);
  });

  it('answers nothing for under two characters, without asking the database', async () => {
    await expect(service.tillSearch(' p ')).resolves.toEqual([]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('offers only units sold at the till, each already priced', async () => {
    const [peak] = await service.tillSearch('peak', 'tier-wholesale');
    expect(peak.units.map((unit) => unit.name)).toEqual(['roll', 'carton']);
    expect(peak.units.find((unit) => unit.name === 'carton')).toMatchObject({
      price: 4_000_000,
      isTierPrice: true,
    });
  });

  it('leaves an unpriced unit with no price rather than a guess', async () => {
    const [peak] = await service.tillSearch('peak', 'tier-wholesale');
    expect(peak.units.find((unit) => unit.name === 'roll')?.price).toBeNull();
  });

  it('names the default selling unit', async () => {
    const [peak] = await service.tillSearch('peak', 'tier-wholesale');
    expect(peak.defaultUnitId).toBe('u-carton');
  });

  it('prices on the default tier when none is given — never the bare fallback', async () => {
    await service.tillSearch('peak');
    expect(prisma.priceTier.findFirst).toHaveBeenCalled();
    const [args] = prisma.product.findMany.mock.calls[0] as [
      { include: { prices: { where: { tierId: string } } } },
    ];
    expect(args.include.prices.where.tierId).toBe('tier-wholesale');
  });

  it('searches active products, every word by name, SKU, size or option, ten at most', async () => {
    await service.tillSearch('peak  14g', 'tier-wholesale');
    const [args] = prisma.product.findMany.mock.calls[0] as [
      {
        where: { isActive: boolean; AND: { OR: object[] }[] };
        take: number;
      },
    ];
    expect(args.where.isActive).toBe(true);
    expect(args.where.AND).toHaveLength(2);
    expect(args.where.AND[0].OR).toHaveLength(4);
    expect(args.take).toBe(10);
  });

  it('a product without options is one row, with no option', async () => {
    const rows = await service.tillSearch('peak', 'tier-wholesale');
    expect(rows).toHaveLength(1);
    expect(rows[0].variant).toBeNull();
  });

  it('a product with options is one row per option, each priced as that option', async () => {
    prisma.product.findMany.mockResolvedValue([EVA]);
    const rows = await service.tillSearch('eva', 'tier-wholesale');
    expect(rows.map((row) => row.variant?.name)).toEqual([
      'Classic',
      'Gold',
      'Moringa',
    ]);
    const cartonOf = (name: string) =>
      rows
        .find((row) => row.variant?.name === name)
        ?.units.find((unit) => unit.name === 'carton')?.price;
    // Gold has its own carton price; the others sell at the product's.
    expect(cartonOf('Gold')).toBe(1_300_000);
    expect(cartonOf('Classic')).toBe(1_100_000);
    expect(cartonOf('Moringa')).toBe(1_100_000);
  });

  it('keeps only the options a word names — "eva gold" is Gold alone', async () => {
    prisma.product.findMany.mockResolvedValue([EVA]);
    const rows = await service.tillSearch('Eva GOLD', 'tier-wholesale');
    expect(rows.map((row) => row.variant?.id)).toEqual(['v-gold']);
  });

  it('drops a product with nothing sold at the till', async () => {
    prisma.product.findMany.mockResolvedValue([
      {
        ...PEAK,
        units: PEAK.units.map((unit) => ({ ...unit, isSellable: false })),
      },
    ]);
    await expect(service.tillSearch('peak', 'tier-wholesale')).resolves.toEqual(
      [],
    );
  });
});

describe('ProductService options (§24)', () => {
  let service: ProductService;
  let stock: { moveIntoVariant: jest.Mock };
  let prisma: {
    product: { update: jest.Mock; findFirst: jest.Mock };
    productVariant: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    stockBalance: { count: jest.Mock };
    productUnit: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  /** Indomie, whose options differ by flavour. */
  const INDOMIE = {
    id: 'prod-1',
    name: 'Indomie',
    variantAttributes: ['Flavour'],
    units: [],
    variants: [],
  };
  const CHICKEN = {
    id: 'v-chicken',
    name: 'Chicken',
    key: 'chicken',
    values: ['Chicken'],
    isActive: true,
  };

  beforeEach(async () => {
    stock = { moveIntoVariant: jest.fn().mockResolvedValue([]) };
    prisma = {
      product: {
        update: jest.fn().mockResolvedValue({ id: 'prod-1' }),
        findFirst: jest.fn().mockResolvedValue(INDOMIE),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(({ data }: { data: { id?: string } }) =>
          Promise.resolve({ id: data.id ?? 'v-new', isActive: true, ...data }),
        ),
        update: jest.fn(
          ({ where, data }: { where: { id: string }; data: object }) =>
            Promise.resolve({ ...CHICKEN, id: where.id, ...data }),
        ),
      },
      stockBalance: { count: jest.fn().mockResolvedValue(0) },
      productUnit: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: TENANT_PRISMA, useValue: prisma },
        { provide: StockService, useValue: stock },
        { provide: CloudinaryService, useValue: { isConfigured: false } },
      ],
    }).compile();

    service = module.get(ProductService);
  });

  const asOrg = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ organizationId: 'org-aaa' }, fn);

  describe("an option's own price", () => {
    let productPrice: {
      updateMany: jest.Mock;
      create: jest.Mock;
      deleteMany: jest.Mock;
    };

    beforeEach(() => {
      productPrice = {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      };
      Object.assign(prisma, { productPrice });
      prisma.productUnit.findMany.mockResolvedValue([
        { id: 'u-carton', name: 'carton' },
      ]);
      prisma.productVariant.findMany.mockResolvedValue([CHICKEN]);
    });

    const price = (row: object) =>
      asOrg(() =>
        service.update('prod-1', {
          prices: [{ unit: 'carton', tierId: 'tier-1', ...row }],
        } as never),
      );

    it('is written against that option, and only that option', async () => {
      await price({ variantId: 'v-chicken', price: 1_300_000 });
      expect(productPrice.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ variantId: 'v-chicken' }) as object,
        data: { price: 1_300_000 },
      });
      expect(productPrice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ variantId: 'v-chicken' }) as object,
      });
    });

    it("keeps the product's own price apart — null in the where, not left out", async () => {
      await price({ price: 1_100_000 });
      expect(productPrice.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ variantId: null }) as object,
        data: { price: 1_100_000 },
      });
    });

    it("is removed by a null price, so the option sells at the product's again", async () => {
      await price({ variantId: 'v-chicken', price: null });
      expect(productPrice.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          variantId: 'v-chicken',
          unitId: 'u-carton',
        }) as object,
      });
      expect(productPrice.create).not.toHaveBeenCalled();
    });

    it("refuses to remove the product's own price", async () => {
      await expect(price({ price: null })).rejects.toThrow(
        /Only an option's own price/,
      );
      expect(productPrice.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses an option from another product', async () => {
      await expect(
        price({ variantId: 'v-elsewhere', price: 1_000 }),
      ).rejects.toThrow(/option this product does not have/);
    });
  });

  it('adds options, named from their values', async () => {
    await asOrg(() =>
      service.update('prod-1', {
        variants: [{ values: ['  Onion   Chicken '] }, { values: ['Chicken'] }],
      }),
    );

    expect(prisma.productVariant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: 'prod-1',
        values: ['Onion Chicken'],
        name: 'Onion Chicken',
        key: 'onion chicken',
      }) as object,
    });
    expect(prisma.productVariant.create).toHaveBeenCalledTimes(2);
  });

  it('refuses options before the product says what they differ by', async () => {
    prisma.product.findFirst.mockResolvedValue({
      ...INDOMIE,
      variantAttributes: [],
    });

    await expect(
      asOrg(() =>
        service.update('prod-1', { variants: [{ values: ['Chicken'] }] }),
      ),
    ).rejects.toThrow(/differ by first/);
  });

  it('refuses an option that does not fill every attribute', async () => {
    prisma.product.findFirst.mockResolvedValue({
      ...INDOMIE,
      variantAttributes: ['Flavour', 'Pack size'],
    });

    await expect(
      asOrg(() =>
        service.update('prod-1', { variants: [{ values: ['Chicken'] }] }),
      ),
    ).rejects.toThrow(/needs a Flavour and a Pack size/);
  });

  it('refuses a new option that repeats a name, case aside', async () => {
    prisma.productVariant.findMany.mockResolvedValue([CHICKEN]);

    await expect(
      asOrg(() =>
        service.update('prod-1', {
          variants: [{ id: 'v-other', values: ['CHICKEN'] }],
        }),
      ),
    ).rejects.toThrow(/already has an option called "Chicken"/);
    expect(prisma.productVariant.create).not.toHaveBeenCalled();
  });

  it('renames an option named by id, and matches one by name without', async () => {
    prisma.productVariant.findMany.mockResolvedValue([CHICKEN]);

    await asOrg(() =>
      service.update('prod-1', {
        variants: [{ id: 'v-chicken', values: ['Chicken Curry'] }],
      }),
    );
    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'v-chicken' },
      data: expect.objectContaining({
        name: 'Chicken Curry',
        key: 'chicken curry',
      }) as object,
    });

    prisma.productVariant.update.mockClear();
    await asOrg(() =>
      service.update('prod-1', {
        variants: [{ values: ['chicken'], sortOrder: 2 }],
      }),
    );
    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'v-chicken' },
      data: expect.objectContaining({ sortOrder: 2 }) as object,
    });
    expect(prisma.productVariant.create).not.toHaveBeenCalled();
  });

  it('refuses to retire the last option still sold', async () => {
    prisma.productVariant.findMany.mockResolvedValue([CHICKEN]);

    await expect(
      asOrg(() =>
        service.update('prod-1', {
          variants: [{ id: 'v-chicken', values: ['Chicken'], isActive: false }],
        }),
      ),
    ).rejects.toThrow(/at least one option that is not retired/);
  });

  describe('a product that already holds stock', () => {
    beforeEach(() => prisma.stockBalance.count.mockResolvedValue(2));

    it('moves that stock into the option named', async () => {
      await asOrg(() =>
        service.update('prod-1', {
          variants: [
            { id: 'v-chicken', values: ['Chicken'] },
            { id: 'v-pepper', values: ['Pepper Soup'] },
          ],
          existingStockVariantId: 'v-chicken',
        }),
      );

      expect(prisma.stockBalance.count).toHaveBeenCalledWith({
        where: { productId: 'prod-1', variantId: null, quantity: { not: 0 } },
      });
      expect(stock.moveIntoVariant).toHaveBeenCalledWith(
        'prod-1',
        expect.objectContaining({ id: 'v-chicken', name: 'Chicken' }),
        prisma,
      );
    });

    it('refuses first options that do not say which one the stock is', async () => {
      await expect(
        asOrg(() =>
          service.update('prod-1', { variants: [{ values: ['Chicken'] }] }),
        ),
      ).rejects.toThrow(/already holds stock\. Say which option/);
      expect(stock.moveIntoVariant).not.toHaveBeenCalled();
    });

    it('moves nothing once the product already had options', async () => {
      prisma.productVariant.findMany.mockResolvedValue([CHICKEN]);

      await asOrg(() =>
        service.update('prod-1', { variants: [{ values: ['Pepper Soup'] }] }),
      );
      expect(stock.moveIntoVariant).not.toHaveBeenCalled();
    });
  });
});

describe('settleAttributes', () => {
  it('tidies the names', () => {
    expect(settleAttributes([' Flavour ', 'Pack  size'], [])).toEqual([
      'Flavour',
      'Pack size',
    ]);
  });

  it('refuses a blank name or two alike', () => {
    expect(() => settleAttributes([' '], [])).toThrow(/needs a name/);
    expect(() => settleAttributes(['Size', 'size'], [])).toThrow(
      /different names/,
    );
  });

  it('allows adding a second attribute, never removing one options use', () => {
    expect(
      settleAttributes(['Flavour', 'Size'], [{ values: ['Chicken'] }]),
    ).toEqual(['Flavour', 'Size']);
    expect(() =>
      settleAttributes(['Flavour'], [{ values: ['Chicken', '70g'] }]),
    ).toThrow(/not removed once options use it/);
  });
});
