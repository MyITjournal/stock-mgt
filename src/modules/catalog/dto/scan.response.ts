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
    example: 24,
    description:
      'How many base units one scan of this code represents, so scanning a carton adds 24 pieces to the ledger rather than one anonymous item.',
  })
  baseQuantity!: number;

  @ApiProperty({
    example: 1200000,
    description: 'Tax-inclusive price for one of `unit`, in kobo.',
  })
  price!: number;

  @ApiProperty({
    description:
      'True when a tier row priced this exact unit. False means the price is `basePrice × factor`, which is right for a sachet and wrong for a carton — the till shows it so a wrong carton price is visible before the sale, not after (§4).',
  })
  isTierPrice!: boolean;

  @ApiProperty({ type: () => TaxSplit })
  tax!: TaxSplit;
}
