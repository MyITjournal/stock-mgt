import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  ProductService,
  assertExactlyOneBaseUnit,
  generateSku,
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
    productPrice: { upsert: jest.Mock };
    productBarcode: { create: jest.Mock };
    productUnit: { findMany: jest.Mock };
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
      productPrice: { upsert: jest.fn().mockResolvedValue({}) },
      productBarcode: { create: jest.fn().mockResolvedValue({}) },
      productUnit: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'unit-carton', name: 'carton' }]),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: TENANT_PRISMA, useValue: prisma },
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
    productPrice: { upsert: jest.Mock };
    productBarcode: { create: jest.Mock };
    productUnit: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const UNITS = [
    { id: 'unit-piece', name: 'piece' },
    { id: 'unit-carton', name: 'carton' },
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
      productPrice: { upsert: jest.fn().mockResolvedValue({}) },
      productBarcode: { create: jest.fn().mockResolvedValue({}) },
      productUnit: { findMany: jest.fn().mockResolvedValue(UNITS) },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: TENANT_PRISMA, useValue: prisma },
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

    expect(prisma.productPrice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          unitId: 'unit-carton',
          tierId: 'tier-retail',
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
    expect(prisma.productPrice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ tierId: 'tier-wholesale' }) as object,
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

    expect(prisma.productPrice.upsert).not.toHaveBeenCalled();
    expect(prisma.productBarcode.create).not.toHaveBeenCalled();
    expect(prisma.priceTier.findFirst).not.toHaveBeenCalled();
  });

  it('upserts on update without touching unlisted prices', async () => {
    // The trap: replacing the set would let a PATCH naming one unit silently
    // delete the price of every other.
    await asOrg(() =>
      service.update('prod-1', {
        prices: [{ unit: 'carton', price: 5600000 }],
      }),
    );

    expect(prisma.productPrice.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.productPrice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { price: 5600000 } }),
    );
  });
});
