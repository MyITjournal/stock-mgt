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
import {
  callerSeesCost,
  redactCost,
  redactCostAll,
} from '../../common/authz/cost-visibility';
import { splitTaxInclusive } from '../../common/money/money';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { BarcodeSymbology, BusinessType, Prisma } from '@prisma/client';
import {
  chooseDefaultSellingUnit,
  defaultIsSellable,
  tillFirstUnit,
} from './selling-units';
import { resolveBarcode } from './barcode';
import { resolveUnitPrice } from './pricing';
import {
  ProductTillUnitView,
  ProductUnitCostView,
  ProductView,
  ResolvedUnitPrice,
} from './dto/product.response';
import { TillSearchResult } from './dto/till-search.response';
import { resolveTierId } from './price-tier.service';
import { averageUnitCost } from '../reports/margins';
import type { ValuedLot } from '../reports/valuation';
import {
  CreateProductDto,
  ProductBarcodeInput,
  ProductPriceInput,
  ProductUnitInput,
  ProductVariantInput,
  UpdateProductDto,
} from './dto/product.dto';
import { cleanVariantText, variantKey, variantName } from './variants';
import { StockService } from '../inventory/stock.service';
import type { StockWriter } from '../inventory/stock.service';

/** How a product's options are listed. Typed apart: `as const` below would make it read-only. */
const VARIANT_ORDER: Prisma.ProductVariantOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { name: 'asc' },
];

const PRODUCT_INCLUDE = {
  category: true,
  packagingType: true,
  // Retired ones included, so the form can show and restore them.
  variants: { orderBy: VARIANT_ORDER },
  units: { orderBy: { factor: 'asc' } },
  prices: { include: { tier: true, unit: true } },
  // Barcodes ride along because a caller that attached them inline needs to
  // see what was minted — an omitted code becomes a generated internal EAN-13.
  barcodes: { include: { unit: true } },
} as const;

/** Suggestions a till shows at once — enough to pick from, few enough to read. */
const TILL_SEARCH_LIMIT = 10;

/** What a product costs the business. Owner, manager and accountant only. */
const PRODUCT_COST_FIELDS = ['costPrice', 'unitCosts'] as const;

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
    private readonly stock: StockService,
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
    const businessType = await this.businessType();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: this.productData(input, { organizationId, sku, businessType }),
          include: { units: true },
        });

        await this.settleSellingUnits(tx, {
          productId: product.id,
          requestedDefault: input.units.find((unit) => unit.isDefaultSelling)
            ?.name,
          businessType,
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

        if (input.variantAttributes?.length || input.variants?.length) {
          await this.writeOptions(tx, {
            productId: product.id,
            organizationId,
            attributes: input.variantAttributes,
            variants: input.variants ?? [],
          });
        }

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
    context: {
      organizationId: string;
      sku: string;
      businessType: BusinessType;
    },
  ) {
    return {
      ...(input.id && { id: input.id }),
      organizationId: context.organizationId,
      sku: context.sku,
      name: input.name,
      size: input.size?.trim() || null,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      packagingTypeId: input.packagingTypeId ?? null,
      basePrice: input.basePrice ?? null,
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
          isSellable:
            unit.isSellable ??
            defaultIsSellable(unit, input.units.length, context.businessType),
          // Settled once every unit exists, by settleSellingUnits: which one
          // is the default depends on which are sold.
          isDefaultSelling: false,
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
            // So "400g" finds every 400g product, whether or not the size
            // was also typed into the name.
            {
              size: { contains: options.search, mode: 'insensitive' as const },
            },
          ],
        }),
      },
      include: PRODUCT_INCLUDE,
      orderBy: { name: 'asc' },
    });

    return redactCostAll(
      await this.withUnitCosts(this.withTillUnit(products)),
      PRODUCT_COST_FIELDS,
    );
  }

  /**
   * The unit the till picks first and the price it would charge for it, on
   * the default price list — the same `tillFirstUnit` and `resolveUnitPrice`
   * the till uses, so a products list cannot show a different unit or price
   * from the one a cashier is handed (2026-10-07). Null price: the till would
   * refuse it for want of one.
   */
  private withTillUnit<
    P extends {
      basePrice: number | null;
      taxRateBps: number;
      units?: readonly {
        id: string;
        name: string;
        factor: number;
        isSellable: boolean;
        isDefaultSelling: boolean;
      }[];
      prices?: readonly {
        tierId: string;
        unitId: string;
        price: number;
        tier?: { isDefault: boolean } | null;
      }[];
    },
  >(products: P[]): (P & { tillUnit: ProductTillUnitView | null })[] {
    return products.map((product) => {
      const prices = product.prices ?? [];
      const unit = tillFirstUnit(product.units ?? []);
      // The default list, read off the prices this product already carries —
      // no lookup. With no row on it there is nothing to find there anyway,
      // and `resolveUnitPrice` falls back exactly as it does for the till.
      const tierId = prices.find((row) => row.tier?.isDefault)?.tierId;
      return {
        ...product,
        tillUnit: unit
          ? {
              unitId: unit.id,
              unitName: unit.name,
              price: resolveUnitPrice(
                { ...product, basePrice: product.basePrice ?? null, prices },
                unit,
                tierId,
              ).price,
            }
          : null,
      };
    });
  }

  /**
   * What one of each unit costs **now** — a carton as a carton, not a piece
   * times 24 — on the same basis as the margins report (2026-10-07).
   *
   * **The average cost of the stock on hand**, from lot totals (§2): opening
   * stock included, so a product that came in as opening stock and has had no
   * delivery yet has a cost — "none yet" beside a priced product, while the
   * reports valued it, was the bug. With nothing on hand, **the most recent
   * lot that received anything**. Rounded once per unit; never
   * `costPrice × factor`, which multiplies a rounded snapshot. Only for a role
   * that may see cost; nobody else pays for the queries, and `redactCost`
   * drops the key for them regardless.
   */
  private async withUnitCosts<
    P extends { id: string; units: readonly { id: string; factor: number }[] },
  >(products: P[]): Promise<(P & { unitCosts?: ProductUnitCostView[] })[]> {
    if (products.length === 0 || !callerSeesCost()) return products;
    const ids = products.map((product) => product.id);

    const [held, latest] = await Promise.all([
      this.prisma.stockBalance.findMany({
        where: { productId: { in: ids }, quantity: { gt: 0 } },
        select: {
          productId: true,
          quantity: true,
          batch: { select: { totalCost: true, quantityReceived: true } },
        },
      }),
      this.prisma.stockBatch.findMany({
        where: { productId: { in: ids }, quantityReceived: { gt: 0 } },
        orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
        distinct: ['productId'],
        select: { productId: true, totalCost: true, quantityReceived: true },
      }),
    ]);

    const lotsOf = new Map<string, ValuedLot[]>();
    for (const row of held) {
      const lots = lotsOf.get(row.productId) ?? [];
      lots.push({
        quantity: row.quantity,
        totalCost: row.batch.totalCost,
        quantityReceived: row.batch.quantityReceived,
      });
      lotsOf.set(row.productId, lots);
    }
    const lastOf = new Map(latest.map((lot) => [lot.productId, lot]));

    return products.map((product) => {
      const last = lastOf.get(product.id);
      // Exact cost of one counted-in unit: the average on hand, else the
      // latest lot.
      const perBase =
        averageUnitCost(lotsOf.get(product.id) ?? []) ??
        (last ? last.totalCost / last.quantityReceived : null);
      return {
        ...product,
        unitCosts:
          perBase === null
            ? []
            : product.units.map((unit) => ({
                unitId: unit.id,
                cost: Math.round(perBase * unit.factor),
              })),
      };
    });
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  /**
   * The till's search-as-you-type: products matching what was typed, each with
   * its sellable units priced on `tierId` — so picking one needs no further
   * request. See `TillSearchResult` for why this is its own endpoint.
   *
   * With no tier given, the default one: a price looked up without a tier is
   * the `basePrice × factor` fallback for everything, which is the carton
   * overcharge §4 exists to prevent.
   */
  async tillSearch(
    query: string,
    tierId?: string,
  ): Promise<TillSearchResult[]> {
    const term = query.trim();
    // One letter matches half the catalog and tells nobody anything.
    if (term.length < 2) return [];

    const tier = await resolveTierId(this.prisma, tierId);

    const contains = { contains: term, mode: 'insensitive' as const };
    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ name: contains }, { sku: contains }, { size: contains }],
      },
      include: {
        units: { orderBy: { factor: 'asc' } },
        prices: tier ? { where: { tierId: tier } } : false,
      },
      orderBy: { name: 'asc' },
      take: TILL_SEARCH_LIMIT,
    });

    return products.flatMap((product) => {
      const sellable = product.units.filter((unit) => unit.isSellable);
      // Nothing the till may sell — not a suggestion worth showing.
      if (sellable.length === 0) return [];
      const priced = { ...product, prices: product.prices ?? [] };
      const units = sellable.map((unit) => {
        const resolved = resolveUnitPrice(priced, unit, tier);
        return {
          id: unit.id,
          name: unit.name,
          factor: unit.factor,
          price: resolved.price,
          isTierPrice: resolved.isTierPrice,
        };
      });
      return [
        {
          id: product.id,
          name: product.name,
          size: product.size,
          sku: product.sku,
          trackStock: product.trackStock,
          defaultUnitId: tillFirstUnit(sellable)!.id,
          units,
        },
      ];
    });
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
      tax:
        product.basePrice === null
          ? null
          : splitTaxInclusive(product.basePrice, product.taxRateBps),
    };
  }

  async update(id: string, input: UpdateProductDto) {
    await this.findOneOrFail(id);
    if (input.categoryId) await this.assertCategoryExists(input.categoryId);
    if (input.packagingTypeId) {
      await this.assertPackagingTypeExists(input.packagingTypeId);
    }
    // Not `assertExactlyOneBaseUnit` here: on a PATCH the units list is a
    // change, not a whole set, so the base-unit rule is checked against the
    // merged result inside `writeUnits`.

    const defaultTierId = await this.resolveDefaultTier(input.prices);
    const barcodes = resolveBarcodeInputs(input.barcodes);
    const organizationId = TenantContext.requireOrganizationId();

    try {
      await this.prisma.product.update({
        where: { id },
        data: {
          ...(input.sku !== undefined && { sku: input.sku }),
          ...(input.name !== undefined && { name: input.name }),
          // Omitted leaves it alone; '' clears it — the letterhead rule.
          ...(input.size !== undefined && {
            size: input.size.trim() || null,
          }),
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

    if (
      input.units?.length ||
      input.prices?.length ||
      barcodes.length ||
      input.variantAttributes !== undefined ||
      input.variants?.length
    ) {
      await this.prisma.$transaction(async (tx) => {
        // Units first: a request may add a unit and price it in one go, so the
        // new unit has to exist before the name lookup below can find it.
        if (input.units?.length) {
          const businessType = await this.businessType();
          await this.writeUnits(tx, {
            productId: id,
            organizationId,
            units: input.units,
            businessType,
          });
          await this.settleSellingUnits(tx, {
            productId: id,
            requestedDefault: input.units.find((unit) => unit.isDefaultSelling)
              ?.name,
            businessType,
          });
        }

        // Prices and barcodes are keyed by unit name, so they need the units as
        // they stand now rather than as the request described them.
        const units = await tx.productUnit.findMany({
          where: { productId: id },
        });
        const unitIdByName = new Map(units.map((unit) => [unit.name, unit.id]));

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

        if (input.variantAttributes !== undefined || input.variants?.length) {
          await this.writeOptions(tx, {
            productId: id,
            organizationId,
            attributes: input.variantAttributes,
            variants: input.variants ?? [],
            existingStockVariantId: input.existingStockVariantId,
          });
        }
      });
    }

    return this.findOneOrFail(id);
  }

  /**
   * Writes what the options differ by and the options themselves — and, when
   * this gives a product that holds stock its first options, moves that stock
   * into the one the request names (DECISIONS.md §24).
   *
   * Upserts like `writeUnits`, for the same reason: options the request leaves
   * out are left alone, and none is ever deleted, since sales and movements
   * point at them. Matched by id when given — which is how one is renamed —
   * else by name, case aside.
   */
  private async writeOptions(
    tx: TransactionClient,
    args: {
      productId: string;
      organizationId: string;
      attributes?: string[];
      variants: ProductVariantInput[];
      existingStockVariantId?: string;
    },
  ): Promise<void> {
    const [product, existing] = await Promise.all([
      tx.product.findFirst({
        where: { id: args.productId },
        select: { name: true, variantAttributes: true },
      }),
      tx.productVariant.findMany({ where: { productId: args.productId } }),
    ]);
    if (!product) throw new NotFoundException('Product not found');

    let attributes = product.variantAttributes;
    if (args.attributes !== undefined) {
      attributes = settleAttributes(args.attributes, existing);
      await tx.product.update({
        where: { id: args.productId },
        data: { variantAttributes: attributes },
      });
    }

    const byId = new Map(existing.map((variant) => [variant.id, variant]));
    const idByKey = new Map(
      existing.map((variant) => [variant.key, variant.id]),
    );

    for (const row of args.variants) {
      if (attributes.length === 0) {
        throw new BadRequestException(
          `Say what the options of "${product.name}" differ by first, in variantAttributes — Flavour, for instance.`,
        );
      }
      const values = row.values.map(cleanVariantText);
      if (values.length !== attributes.length || values.some((v) => !v)) {
        throw new BadRequestException(
          `Each option of "${product.name}" needs ${attributes.length === 1 ? `a ${attributes[0]}` : `a ${attributes.join(' and a ')}`}; "${row.values.join(' / ')}" does not have that.`,
        );
      }
      const name = variantName(values);
      const key = variantKey(values);

      const target = row.id
        ? byId.get(row.id)
        : byId.get(idByKey.get(key) ?? '');
      const clash = idByKey.get(key);
      if (clash && clash !== target?.id) {
        throw new ConflictException(
          `"${product.name}" already has an option called "${byId.get(clash)?.name ?? name}".`,
        );
      }

      const data = {
        values,
        name,
        key,
        ...(row.isActive !== undefined && { isActive: row.isActive }),
        ...(row.sortOrder !== undefined && { sortOrder: row.sortOrder }),
      };

      if (target) {
        const updated = await tx.productVariant.update({
          where: { id: target.id },
          data,
        });
        idByKey.delete(target.key);
        idByKey.set(key, updated.id);
        byId.set(updated.id, updated);
        continue;
      }

      try {
        const created = await tx.productVariant.create({
          data: {
            ...(row.id && { id: row.id }),
            organizationId: args.organizationId,
            productId: args.productId,
            ...data,
          },
        });
        idByKey.set(key, created.id);
        byId.set(created.id, created);
      } catch (error) {
        // Only an id already used elsewhere can get here: names were checked
        // above, against every option this product has.
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            `The option id ${row.id} is already in use.`,
          );
        }
        throw error;
      }
    }

    const options = [...byId.values()];
    if (options.length > 0 && !options.some((variant) => variant.isActive)) {
      throw new BadRequestException(
        `"${product.name}" needs at least one option that is not retired. Retire the product instead if it is no longer sold.`,
      );
    }

    // First options on a product that already holds stock: that stock has to
    // become one of them, or it would sit under no option, unsellable.
    if (existing.length > 0 || options.length === 0) return;
    const holding = await tx.stockBalance.count({
      where: {
        productId: args.productId,
        variantId: null,
        quantity: { not: 0 },
      },
    });
    if (holding === 0) return;

    const chosen = args.existingStockVariantId
      ? byId.get(args.existingStockVariantId)
      : undefined;
    if (!chosen) {
      throw new BadRequestException(
        `"${product.name}" already holds stock. Say which option that stock is (existingStockVariantId): it moves there at its original cost, and a count can spread it across the others later.`,
      );
    }
    if (!chosen.isActive) {
      throw new BadRequestException(
        `The stock cannot go to "${chosen.name}", which is retired.`,
      );
    }
    await this.stock.moveIntoVariant(
      args.productId,
      chosen,
      tx as unknown as StockWriter,
    );
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
   * Upserts the listed units and leaves every unlisted one alone.
   *
   * **Added because `PATCH /products/:id` used to take a `units` array,
   * validate it, and write nothing** — answering 200 while changing nothing,
   * which is the worst of the three possible behaviours. A shop that starts
   * selling by the carton could not record that without recreating the
   * product.
   *
   * Same shape as `writePrices`, and for the same reason: a PATCH naming one
   * unit must not delete the rest. Three deliberate limits:
   *
   * - **Nothing is ever deleted.** `StockMovement`, `SaleLine` and
   *   `GoodsReceiptLine` all point at units; removing one would orphan history
   *   that is supposed to be immutable.
   * - **`factor` may change, and that is safe** only because every row that
   *   depends on it copies it at write time — `SaleLine.unitFactor` is the
   *   snapshot, so redefining a carton cannot rewrite what a past sale took off
   *   the shelf (§4).
   * - **The base unit cannot move.** `isBase` is derived from `factor === 1`
   *   and stock is recorded in that unit (§2), so changing which unit is the
   *   base would silently reinterpret every quantity in the ledger. A unit that
   *   would change the answer is refused rather than applied.
   */
  private async writeUnits(
    tx: TransactionClient,
    args: {
      productId: string;
      organizationId: string;
      units: ProductUnitInput[];
      businessType: BusinessType;
    },
  ): Promise<void> {
    const existing = await tx.productUnit.findMany({
      where: { productId: args.productId },
    });
    const byName = new Map(existing.map((unit) => [unit.name, unit]));

    // Exactly one base unit must survive, and the check is on the **merged**
    // result rather than on the request. `assertExactlyOneBaseUnit` validates a
    // complete set, which is right for `POST /products` and wrong here: a PATCH
    // adding a carton to a product that already has a piece lists no base at
    // all, and would be refused for describing a change rather than a whole.
    const merged = new Map(
      existing.map((unit) => [unit.name, unit.factor] as const),
    );
    for (const row of args.units) merged.set(row.name, row.factor);
    const bases = [...merged.entries()].filter(([, factor]) => factor === 1);
    if (bases.length !== 1) {
      throw new BadRequestException(
        bases.length === 0
          ? 'That would leave the product with no base unit. Stock is recorded in the unit whose factor is 1, so exactly one is required.'
          : `That would give the product ${bases.length} base units (${bases.map(([name]) => name).join(', ')}). Exactly one unit may have factor 1.`,
      );
    }

    for (const row of args.units) {
      const current = byName.get(row.name);

      // Moving the base would reinterpret every quantity already in the ledger,
      // which is the one thing no product edit may do.
      const wouldBecomeBase = row.factor === 1;
      if (current && current.isBase !== wouldBecomeBase) {
        throw new BadRequestException(
          `"${row.name}" is ${current.isBase ? 'the base unit' : 'not the base unit'}, and that cannot change: stock is recorded in base units, so moving it would reinterpret every quantity already in the ledger. Add a new unit instead.`,
        );
      }

      await tx.productUnit.upsert({
        where: {
          organizationId_productId_name: {
            organizationId: args.organizationId,
            productId: args.productId,
            name: row.name,
          },
        },
        create: {
          organizationId: args.organizationId,
          productId: args.productId,
          name: row.name,
          factor: row.factor,
          isBase: row.factor === 1,
          // A unit added to an existing product: there are already others,
          // so only the business type decides.
          isSellable:
            row.isSellable ??
            defaultIsSellable(row, merged.size, args.businessType),
          isDefaultSelling: false,
        },
        update: {
          factor: row.factor,
          ...(row.isSellable !== undefined && { isSellable: row.isSellable }),
        },
      });
    }
  }

  /**
   * Leaves the product with at least one unit sold at the till and exactly one
   * default, which is one of the sold ones. Run after every write that can
   * change units — see `chooseDefaultSellingUnit` for how it decides.
   *
   * Settled here rather than trusted from the request because the request is
   * a *change*: a PATCH unticking the carton says nothing about which unit
   * should take over as the default, and must still leave one.
   */
  private async settleSellingUnits(
    tx: TransactionClient,
    args: {
      productId: string;
      requestedDefault: string | undefined;
      businessType: BusinessType;
    },
  ): Promise<void> {
    const units = await tx.productUnit.findMany({
      where: { productId: args.productId },
    });
    const chosen = chooseDefaultSellingUnit(
      units,
      args.requestedDefault,
      args.businessType,
    );
    await tx.productUnit.updateMany({
      where: { productId: args.productId, id: { not: chosen } },
      data: { isDefaultSelling: false },
    });
    await tx.productUnit.update({
      where: { id: chosen },
      data: { isDefaultSelling: true },
    });
  }

  /** The shop's kind of trading, which sets how a new unit starts out (§22). */
  private async businessType(): Promise<BusinessType> {
    const organization = await this.prisma.organization.findFirst({
      where: { id: TenantContext.requireOrganizationId() },
      select: { businessType: true },
    });
    return organization?.businessType ?? BusinessType.mixed;
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

      // Update-then-create rather than `upsert`: "one price per product, tier,
      // unit and option" is a pair of partial unique indexes (§24), which a
      // Prisma upsert cannot name. These are the product's own prices, so the
      // option is null — and in the where as null, or an option's override
      // would be overwritten too.
      const where = {
        productId: args.productId,
        tierId,
        unitId,
        variantId: null,
      };
      const { count } = await tx.productPrice.updateMany({
        where,
        data: { price: row.price },
      });
      if (count === 0) {
        await tx.productPrice.create({
          data: {
            organizationId: args.organizationId,
            ...where,
            price: row.price,
          },
        });
      }
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
   * Price of one `unitId` for `tierId` — the default tier when none is named
   * — falling back to the base price scaled by the unit factor when no tier row
   * exists, and `null` when there is no base price either.
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

    return {
      productId,
      ...resolveUnitPrice(
        product,
        unit,
        await resolveTierId(this.prisma, tierId),
      ),
    };
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
    const [withCosts] = await this.withUnitCosts(this.withTillUnit([product]));
    return redactCost(withCosts, PRODUCT_COST_FIELDS);
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

/**
 * What a product's options differ by, cleaned and checked: at most two
 * (the DTO caps it), each named, no two alike. Renaming is always fine, and
 * so is adding a second; removing one that options already fill is refused,
 * since it would leave their values meaning nothing.
 */
export function settleAttributes(
  requested: readonly string[],
  existing: readonly { values: readonly string[] }[],
): string[] {
  const cleaned = requested.map(cleanVariantText);
  if (cleaned.some((attribute) => !attribute)) {
    throw new BadRequestException(
      'An attribute needs a name — Flavour, Size, Colour.',
    );
  }
  const lower = cleaned.map((attribute) => attribute.toLowerCase());
  if (new Set(lower).size !== lower.length) {
    throw new BadRequestException('The two attributes need different names.');
  }
  const used = Math.max(0, ...existing.map((variant) => variant.values.length));
  if (cleaned.length < used) {
    throw new BadRequestException(
      `The options already use ${used === 1 ? 'one attribute' : 'two attributes'}. An attribute can be renamed or added, but not removed once options use it.`,
    );
  }
  return cleaned;
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
