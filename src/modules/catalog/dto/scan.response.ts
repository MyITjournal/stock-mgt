import { ApiProperty } from '@nestjs/swagger';
import { BarcodeSymbology } from '@prisma/client';

/**
 * What `GET /scan/:code` returns.
 *
 * **These are the service's declared return types, not a description of them.**
 * `ScanService.resolve()` is annotated with {@link ScanResult}, so a field that
 * changes shape is a compile error rather than a till quietly rendering
 * `undefined` (DECISIONS.md §17).
 *
 * This is the first thing the till calls and the fastest path through it: a USB
 * barcode scanner is a keyboard, so one code arrives as typed characters and an
 * Enter, and everything needed to put a line in the cart comes back in one
 * round trip — which product, which unit, what it costs, and how many base
 * units the scan stands for.
 */

class ScannedProduct {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'PEAK-400G' })
  sku!: string;

  @ApiProperty({ example: 'Peak Milk Powder 400g' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: '400g' })
  size!: string | null;

  @ApiProperty({
    description:
      'False for a service or a non-stocked line, which sells without touching the ledger.',
  })
  trackStock!: boolean;
}

class ScannedUnit {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'carton' })
  name!: string;

  @ApiProperty({
    example: 24,
    description: 'How many base units one of these is. The base unit is 1.',
  })
  factor!: number;

  @ApiProperty({
    description:
      'Whether the till may sell this unit. A code on an unsold unit — the single sachet a distributor never sells — still resolves, so a delivery can scan it; the till refuses it.',
  })
  isSellable!: boolean;
}

class TaxSplit {
  @ApiProperty({
    description:
      'What the customer pays. Prices are stored tax-inclusive (§2).',
  })
  gross!: number;

  @ApiProperty({ description: 'The gross less the tax within it.' })
  net!: number;

  @ApiProperty({
    description: 'The VAT already inside the price, derived by subtraction.',
  })
  tax!: number;
}

/**
 * One option of the scanned product, priced for the scanned unit — offered when
 * the code is on the product as a whole and the till has to ask which option.
 */
class ScannedOption {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Gold' })
  name!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Tax-inclusive, in kobo, for one of `unit` as this option.',
  })
  price!: number | null;

  @ApiProperty()
  isTierPrice!: boolean;
}

export class ScanResult {
  @ApiProperty({
    example: '6154000010025',
    description: 'The code as stored, after normalisation.',
  })
  code!: string;

  @ApiProperty({ enum: BarcodeSymbology, enumName: 'BarcodeSymbology' })
  symbology!: BarcodeSymbology;

  @ApiProperty({ type: () => ScannedProduct })
  product!: ScannedProduct;

  @ApiProperty({ type: () => ScannedUnit })
  unit!: ScannedUnit;

  @ApiProperty({
    type: () => ScannedOption,
    nullable: true,
    description:
      'The option this code is printed on — Eva soap Gold has its own barcode — priced as that option. Null when the code is on the product as a whole.',
  })
  variant!: ScannedOption | null;

  @ApiProperty({
    type: () => [ScannedOption],
    description:
      'Set only when the product has options and this code names none: every active option, priced, so the till can ask which one without another request. Empty otherwise.',
  })
  options!: ScannedOption[];

  @ApiProperty({
    example: 24,
    description:
      'How many base units one scan of this code represents, so scanning a carton adds 24 pieces to the ledger rather than one anonymous item.',
  })
  baseQuantity!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1200000,
    description:
      'Tax-inclusive price for one of `unit`, in kobo. Null when the unit has no price and the product no base price to fall back on — the till refuses it.',
  })
  price!: number | null;

  @ApiProperty({
    description:
      'True when a tier row priced this exact unit. False means the price is `basePrice × factor`, which is right for a sachet and wrong for a carton — the till shows it so a wrong carton price is visible before the sale, not after (§4).',
  })
  isTierPrice!: boolean;

  @ApiProperty({ type: () => TaxSplit, nullable: true })
  tax!: TaxSplit | null;
}
