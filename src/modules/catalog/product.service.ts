import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { redactCost, redactCostAll } from '../../common/authz/cost-visibility';
import { splitTaxInclusive } from '../../common/money/money';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { BarcodeSymbology } from '@prisma/client';
import { resolveBarcode } from './barcode';
import { resolveUnitPrice } from './pricing';
import { ProductView, ResolvedUnitPrice } from './dto/product.response';
import {
  CreateProductDto,
  ProductBarcodeInput,
  ProductPriceInput,
  ProductUnitInput,
  UpdateProductDto,
} from './dto/product.dto';

const PRODUCT_INCLUDE = {
  category: true,
  packagingType: true,
  units: { orderBy: { factor: 'asc' } },
  prices: { include: { tier: true, unit: true } },
  // Barcodes ride along because a caller that attached them inline needs to
  // see what was minted — an omitted code becomes a generated internal EAN-13.
  barcodes: { include: { unit: true } },
} as const;

/** What a product costs the business. Owner, manager and accountant only. */
const PRODUCT_COST_FIELDS = ['costPrice'] as const;

/**
 * One uploaded file, typed structurally.
 *
 * The multer types are not installed, and pulling in a dependency to name four
 * fields is not worth it. Multer hands us a buffer; this names the part of that
 * we actually use.
 */
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@Injectable()
export class ProductService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly images: CloudinaryService,
  ) {}

  async create(input: CreateProductDto) {
    assertExactlyOneBaseUnit(input.units);
    if (input.categoryId) await this.assertCategoryExists(input.categoryId);
    if (input.packagingTypeId) {
      await this.assertPackagingTypeExists(input.packagingTypeId);
    }

    const sku = input.sku?.trim() || generateSku(input.name);
    const organizationId = TenantContext.requireOrganizationId();

    // Resolved before the transaction opens: both of these read rows the
    // transaction does not write, and a check-digit rejection should not have
    // held a write lock while it was being decided.
    const defaultTierId = await this.resolveDefaultTier(input.prices);
    const barcodes = resolveBarcodeInputs(input.barcodes);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: this.productData(input, { organizationId, sku }),
          include: { units: true },
        });

        const unitIdByName = new Map(
          product.units.map((unit) => [unit.name, unit.id]),
        );

        await this.writePrices(tx, {
          productId: product.id,
          organizationId,
          unitIdByName,
          defaultTierId,
          prices: input.prices,
        });

        await this.writeBarcodes(tx, {
          productId: product.id,
          organizationId,
          unitIdByName,
          barcodes,
        });

        return product.id;
      });

      return await this.findOneOrFail(created);
    } catch (error) {
      throw translateUniqueViolation(error, sku);
    }
  }

  /** The scalar columns, shared by create and the transaction above. */
  private productData(
    input: CreateProductDto,
    context: { organizationId: string; sku: string },
  ) {
    return {
      ...(input.id && { id: input.id }),
      organizationId: context.organizationId,
      sku: context.sku,
      name: input.name,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      packagingTypeId: input.packagingTypeId ?? null,
      basePrice: input.basePrice,
      costPrice: input.costPrice ?? null,
      ...(input.taxRateBps !== undefined && { taxRateBps: input.taxRateBps }),
      ...(input.trackStock !== undefined && { trackStock: input.trackStock }),
      ...(input.reorderPoint !== undefined && {
        reorderPoint: input.reorderPoint,
      }),
      ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
      units: {
        create: input.units.map((unit) => ({
          organizationId: context.organizationId,
          name: unit.name,
          factor: unit.factor,
          // The factor-1 unit is the base; assertExactlyOneBaseUnit has
          // already guaranteed there is exactly one.
          isBase: unit.factor === 1,
          isDefaultSelling: unit.isDefaultSelling ?? unit.factor === 1,
        })),
      },
    };
  }

  async findAll(
    options: {
      categoryId?: string;
      packagingTypeId?: string;
      search?: string;
    } = {},
  ): Promise<ProductView[]> {
    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...(options.categoryId && { categoryId: options.categoryId }),
        ...(options.packagingTypeId && {
          packagingTypeId: options.packagingTypeId,
        }),
        ...(options.search && {
          OR: [
            {
              name: { contains: options.search, mode: 'insensitive' as const },
            },
            { sku: { contains: options.search, mode: 'insensitive' as const } },
          ],
        }),
      },
      include: PRODUCT_INCLUDE,
      orderBy: { name: 'asc' },
    });

    return redactCostAll(products, PRODUCT_COST_FIELDS);
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  /**
   * Product with its tax split, for receipts and margin display.
   *
   * Prices are stored tax-inclusive, so the VAT portion is derived here rather
   * than stored — the two can then never disagree.
   */
  async findOneWithTax(id: string) {
    const product = await this.findOneOrFail(id);
    return {
      ...product,
      tax: splitTaxInclusive(product.basePrice, product.taxRateBps),
    };
  }

  async update(id: string, input: UpdateProductDto) {
    await this.findOneOrFail(id);
    if (input.categoryId) await this.assertCategoryExists(input.categoryId);
    if (input.packagingTypeId) {
      await this.assertPackagingTypeExists(input.packagingTypeId);
    }
    if (input.units) assertExactlyOneBaseUnit(input.units);

    const defaultTierId = await this.resolveDefaultTier(input.prices);
    const barcodes = resolveBarcodeInputs(input.barcodes);
    const organizationId = TenantContext.requireOrganizationId();

    try {
      await this.prisma.product.update({
        where: { id },
        data: {
          ...(input.sku !== undefined && { sku: input.sku }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.categoryId !== undefined && {
            categoryId: input.categoryId,
          }),
          ...(input.packagingTypeId !== undefined && {
            packagingTypeId: input.packagingTypeId,
          }),
          ...(input.basePrice !== undefined && { basePrice: input.basePrice }),
          ...(input.costPrice !== undefined && { costPrice: input.costPrice }),
          ...(input.taxRateBps !== undefined && {
            taxRateBps: input.taxRateBps,
          }),
          ...(input.trackStock !== undefined && {
            trackStock: input.trackStock,
          }),
          ...(input.reorderPoint !== undefined && {
            reorderPoint: input.reorderPoint,
          }),
          ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
        },
      });
    } catch (error) {
      throw translateUniqueViolation(error, input.sku ?? '');
    }

    // Prices and barcodes are keyed by unit name, so they need the units as
    // they stand now rather than as the request described them.
    if (input.prices?.length || barcodes.length) {
      const units = await this.prisma.productUnit.findMany({
        where: { productId: id },
      });
      const unitIdByName = new Map(units.map((unit) => [unit.name, unit.id]));

      await this.prisma.$transaction(async (tx) => {
        await this.writePrices(tx, {
          productId: id,
          organizationId,
          unitIdByName,
          defaultTierId,
          prices: input.prices,
        });
        await this.writeBarcodes(tx, {
          productId: id,
          organizationId,
          unitIdByName,
          barcodes,
        });
      });
    }

    return this.findOneOrFail(id);
  }

  /**
   * The tier a price with no `tierId` belongs to.
   *
   * Looked up once per request rather than per row, and only when something
   * actually needs it. A tier price is what a walk-in gets, so the default tier
   * is the sensible answer and the one a caller filling in a product form has
   * in mind.
   */
  private async resolveDefaultTier(
    prices?: ProductPriceInput[],
  ): Promise<string | null> {
    if (!prices?.some((row) => !row.tierId)) return null;

    const tier = await this.prisma.priceTier.findFirst({
      where: { isDefault: true, deletedAt: null },
    });
    if (!tier) {
      throw new BadRequestException(
        'This organization has no default price tier, so a price must name its tierId.',
      );
    }
    return tier.id;
  }

  /**
   * Upserts the listed prices and leaves every unlisted one alone.
   *
   * Replacing the whole set would mean a PATCH that mentions one unit silently
   * deleting the prices for every other — the same class of silent loss as
   * costing a forced sale at zero, and just as hard to notice afterwards.
   */
  private async writePrices(
    tx: TransactionClient,
    args: {
      productId: string;
      organizationId: string;
      unitIdByName: Map<string, string>;
      defaultTierId: string | null;
      prices?: ProductPriceInput[];
    },
  ): Promise<void> {
    for (const row of args.prices ?? []) {
      const unitId = args.unitIdByName.get(row.unit);
      if (!unitId) {
        throw new BadRequestException(
          `No unit named "${row.unit}" on this product. Prices are keyed by unit name, from the units list.`,
        );
      }

      const tierId = row.tierId ?? args.defaultTierId;
      if (!tierId) {
        throw new BadRequestException(
          `The price for "${row.unit}" needs a tierId.`,
        );
      }

      await tx.productPrice.upsert({
        where: {
          organizationId_productId_tierId_unitId: {
            organizationId: args.organizationId,
            productId: args.productId,
            tierId,
            unitId,
          },
        },
        create: {
          organizationId: args.organizationId,
          productId: args.productId,
          tierId,
          unitId,
          price: row.price,
        },
        update: { price: row.price },
      });
    }
  }

  /** Attaches the listed barcodes. Codes are already validated by this point. */
  private async writeBarcodes(
    tx: TransactionClient,
    args: {
      productId: string;
      organizationId: string;
      unitIdByName: Map<string, string>;
      barcodes: ResolvedBarcode[];
    },
  ): Promise<void> {
    for (const row of args.barcodes) {
      const unitId = args.unitIdByName.get(row.unit);
      if (!unitId) {
        throw new BadRequestException(
          `No unit named "${row.unit}" on this product. Barcodes are keyed by unit name, from the units list.`,
        );
      }

      try {
        await tx.productBarcode.create({
          data: {
            organizationId: args.organizationId,
            productId: args.productId,
            unitId,
            code: row.code,
            symbology: row.symbology,
            isPrimary: row.isPrimary,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            `The barcode "${row.code}" is already assigned to another product in this organization`,
          );
        }
        throw error;
      }
    }
  }

  /** Soft delete, so historical sales keep resolving to a product. */
  async remove(id: string) {
    await this.findOneOrFail(id);
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * Price of one `unitId` for `tierId`, falling back to the base price scaled
   * by the unit factor when no tier row exists.
   *
   * The fallback is a convenience, not a rule: a real carton price is normally
   * *below* factor x base, which is exactly why ProductPrice is keyed by unit.
   */
  async resolvePrice(
    productId: string,
    unitId: string,
    tierId?: string,
  ): Promise<ResolvedUnitPrice> {
    const product = await this.findOneOrFail(productId);
    const unit = product.units.find((u) => u.id === unitId);
    if (!unit) {
      throw new BadRequestException(
        'That unit does not belong to this product',
      );
    }

    return { productId, ...resolveUnitPrice(product, unit, tierId) };
  }

  /**
   * Uploads a product photo and points the product at it.
   *
   * The previous image is deleted from the CDN afterwards rather than before:
   * if the upload fails, the product keeps the picture it had. Deleting first
   * would trade a failed upload for no image at all.
   *
   * A failure to delete the old one is swallowed on purpose. The new image is
   * already saved and the product is correct; an orphaned file on the CDN is
   * not worth failing a request the user experienced as successful.
   */
  async setImage(id: string, file: UploadedImage) {
    this.images.assertConfigured();
    const product = await this.findOneOrFail(id);

    const uploaded = await this.images.uploadImage(
      file.buffer,
      `products/${TenantContext.requireOrganizationId()}`,
    );

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        imageUrl: uploaded.secure_url,
        imagePublicId: uploaded.public_id,
      },
      include: PRODUCT_INCLUDE,
    });

    if (product.imagePublicId && product.imagePublicId !== uploaded.public_id) {
      await this.images
        .deleteImage(product.imagePublicId)
        .catch(() => undefined);
    }

    return updated;
  }

  /**
   * Removes the picture. Only deletes from the CDN when we were the ones who
   * put it there — a URL somebody supplied points at a file that is not ours.
   */
  async removeImage(id: string) {
    const product = await this.findOneOrFail(id);

    const updated = await this.prisma.product.update({
      where: { id },
      data: { imageUrl: null, imagePublicId: null },
      include: PRODUCT_INCLUDE,
    });

    if (product.imagePublicId) {
      await this.images
        .deleteImage(product.imagePublicId)
        .catch(() => undefined);
    }

    return updated;
  }

  /**
   * Every read of a product goes through here, which is why the cost redaction
   * sits here rather than at each of the seven call sites.
   *
   * `costPrice` is written by create and update and read by nothing — §2
   * forbids it as an input to valuation, so no report wants it — which makes
   * dropping it for a rep free of consequences anywhere else.
   */
  private async findOneOrFail(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: PRODUCT_INCLUDE,
    });
    if (!product) throw new NotFoundException('Product not found');
    return redactCost(product, PRODUCT_COST_FIELDS);
  }

  private async assertCategoryExists(categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
    });
    if (!category) throw new NotFoundException('Category not found');
  }

  private async assertPackagingTypeExists(packagingTypeId: string) {
    const packagingType = await this.prisma.packagingType.findFirst({
      where: { id: packagingTypeId, deletedAt: null },
    });
    if (!packagingType) {
      throw new NotFoundException('Packaging type not found');
    }
  }
}

/**
 * Stock is recorded in base units, so every product needs exactly one unit of
 * factor 1. Without it, a carton could never be converted to a countable
 * quantity and the Slice 3 ledger would have nothing to anchor to.
 */
export function assertExactlyOneBaseUnit(units: ProductUnitInput[]): void {
  const bases = units.filter((unit) => unit.factor === 1);

  if (bases.length === 0) {
    throw new BadRequestException(
      'One unit must have factor 1 to act as the base unit that stock is counted in',
    );
  }
  if (bases.length > 1) {
    throw new BadRequestException(
      `Only one unit may have factor 1, found ${bases.length}: ${bases
        .map((u) => u.name)
        .join(', ')}`,
    );
  }

  const names = units.map((unit) => unit.name.toLowerCase());
  if (new Set(names).size !== names.length) {
    throw new BadRequestException('Unit names must be unique within a product');
  }
}

/** "Peak Milk 400g" -> "PEAK-MILK-400G". Unique per organization. */
export function generateSku(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'PRODUCT';
}

function translateUniqueViolation(error: unknown, sku: string): Error {
  if (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  ) {
    return new ConflictException(`A product with SKU "${sku}" already exists`);
  }
  return error as Error;
}

/**
 * The client handed to a `$transaction` callback: the tenant client minus the
 * methods that cannot be called from inside one.
 */
type TransactionClient = Omit<
  TenantPrisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

interface ResolvedBarcode {
  unit: string;
  code: string;
  symbology: BarcodeSymbology;
  isPrimary: boolean;
}

/**
 * Validates every inline barcode before anything is written.
 *
 * Done up front, outside the transaction, so a mistyped check digit on the
 * third code does not roll back a product that was otherwise fine — and so the
 * message names which line was wrong rather than just refusing the request.
 */
function resolveBarcodeInputs(
  inputs?: ProductBarcodeInput[],
): ResolvedBarcode[] {
  return (inputs ?? []).map((row) => {
    const resolved = resolveBarcode(row);
    if ('error' in resolved) {
      throw new BadRequestException(
        `Barcode for "${row.unit}": ${resolved.error}`,
      );
    }
    return { unit: row.unit, ...resolved, isPrimary: row.isPrimary ?? false };
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
