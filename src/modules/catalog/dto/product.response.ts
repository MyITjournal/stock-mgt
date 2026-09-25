import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BarcodeSymbology } from '@prisma/client';

/**
 * What a product looks like on the way out of `GET /products`,
 * `GET /products/:id`, `POST /products` and `PATCH /products/:id`.
 *
 * **This is the service's declared return type, not a description of it**
 * (DECISIONS.md §17).
 *
 * `costPrice` is **optional, not nullable**, and the distinction carries two
 * different facts that happen to look the same on a screen:
 *
 * - *Absent* — the caller is a rep, and `redactCost` removed the key (§9).
 * - *Null* — the key is there and nothing has ever been bought, so no cost is
 *   known.
 *
 * A client that collapses the two renders "free goods" where it means "not
 * allowed to know". `<Money>` on the web side prints an em dash for both, which
 * is the one rendering that is honest about each.
 *
 * Units, prices and barcodes ride along because they are what makes a product
 * sellable: a till needs to know a carton is 24 pieces and what a carton costs
 * before it can put a line in the cart.
 */

export class CategoryView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'Beverages' })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  parentId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}

export class PackagingTypeView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'Carton' })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ example: 10 })
  sortOrder!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}

export class PriceTierView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'Retail' })
  name!: string;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}

export class ProductUnitView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'carton' })
  name!: string;

  @ApiProperty({
    example: 24,
    description:
      'How many base units one of these is. Stock is recorded in the unit whose factor is 1 (§2).',
  })
  factor!: number;

  @ApiProperty({ description: 'The one unit with `factor = 1`.' })
  isBase!: boolean;

  @ApiProperty({ description: 'What the till offers first.' })
  isDefaultSelling!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class ProductPriceView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  tierId!: string;

  @ApiProperty({ format: 'uuid' })
  unitId!: string;

  @ApiProperty({
    example: 1200000,
    description: 'Tax-inclusive price of one `unitId`, in kobo.',
  })
  price!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => PriceTierView })
  tier!: PriceTierView;

  @ApiProperty({ type: () => ProductUnitView })
  unit!: ProductUnitView;
}

export class ProductBarcodeView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  unitId!: string;

  @ApiProperty({ example: '6154000010025' })
  code!: string;

  @ApiProperty({ enum: BarcodeSymbology, enumName: 'BarcodeSymbology' })
  symbology!: BarcodeSymbology;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => ProductUnitView })
  unit!: ProductUnitView;
}

/**
 * The VAT already inside a price, split out for display.
 *
 * Declared **above** the class that uses it on purpose: `emitDecoratorMetadata`
 * writes a direct `design:type` reference for a non-array property, and that
 * reference is evaluated while the decorator runs — so a class named before it
 * is initialised throws `Cannot access 'X' before initialization` at import
 * time. TypeScript does not catch it; the server refusing to boot does.
 */
export class UnitTaxSplit {
  @ApiProperty({ description: 'What the customer pays.' })
  gross!: number;

  @ApiProperty({ description: 'The gross less the VAT inside it.' })
  net!: number;

  @ApiProperty({ description: 'The VAT, derived by subtraction (§2).' })
  tax!: number;
}

/**
 * What `GET /products/:id/price` returns: one unit's price for one tier.
 *
 * It exists so that **nothing outside the server ever works out a price.** The
 * till has to re-price a line when the seller switches a piece to a carton, or
 * when naming the customer moves the whole cart onto another tier — and the
 * fallback for a unit with no tier row is `basePrice × factor` (§4), which is
 * arithmetic. Doing it in the browser would be a second implementation of
 * pricing, and the first thing to disagree with the receipt.
 */
export class ResolvedUnitPrice {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  unitId!: string;

  @ApiProperty({ example: 'carton' })
  unitName!: string;

  @ApiProperty({
    example: 24,
    description: 'How many base units one of these is.',
  })
  baseQuantity!: number;

  @ApiProperty({
    example: 1200000,
    description: 'Tax-inclusive, in kobo.',
  })
  price!: number;

  @ApiProperty({
    description:
      'False means no tier priced this unit and the price is `basePrice × factor` — right for a sachet, wrong for a carton. The till surfaces it so a wrong carton price is caught before the sale (§4).',
  })
  isTierPrice!: boolean;

  @ApiProperty({ type: () => UnitTaxSplit })
  tax!: UnitTaxSplit;
}

export class ProductView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'PEAK-400G' })
  sku!: string;

  @ApiProperty({ example: 'Peak Milk Powder 400g' })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  categoryId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  packagingTypeId!: string | null;

  @ApiProperty({
    example: 50000,
    description:
      'Tax-inclusive price of one **base** unit, in kobo. A unit without a tier row falls back to `basePrice × factor`, which is right for a sachet and wrong for a carton (§4).',
  })
  basePrice!: number;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'What one base unit last cost to buy. **Absent** for a role that may not see cost (§9); **null** when nothing has been bought yet. Never an input to stock valuation, which §2 values from lot totals instead.',
  })
  costPrice?: number | null;

  @ApiProperty({ example: 750, description: 'VAT rate in basis points.' })
  taxRateBps!: number;

  @ApiProperty({ type: String, nullable: true })
  imageUrl!: string | null;

  @ApiProperty({ type: String, nullable: true })
  imagePublicId!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'In base units. Below this, the product shows as low stock.',
  })
  reorderPoint!: number | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({
    description:
      'False for a service or anything sold without touching the ledger.',
  })
  trackStock!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;

  @ApiProperty({ type: () => CategoryView, nullable: true })
  category!: CategoryView | null;

  @ApiProperty({ type: () => PackagingTypeView, nullable: true })
  packagingType!: PackagingTypeView | null;

  @ApiProperty({
    type: () => [ProductUnitView],
    description: 'Smallest first — ordered by factor.',
  })
  units!: ProductUnitView[];

  @ApiProperty({ type: () => [ProductPriceView] })
  prices!: ProductPriceView[];

  @ApiProperty({ type: () => [ProductBarcodeView] })
  barcodes!: ProductBarcodeView[];
}
