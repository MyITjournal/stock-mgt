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
    product: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    packagingType: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      product: {
        create: jest.fn().mockResolvedValue({ id: 'prod-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      packagingType: { findFirst: jest.fn().mockResolvedValue(null) },
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
