import { ApiProperty } from '@nestjs/swagger';

export class OpeningStockUnitView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'How many base units it holds.' })
  factor!: number;
}

/** A product that has never had stock come in at the location asked about. */
export class OpeningStockProductView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  size!: string | null;

  @ApiProperty()
  sku!: string;

  @ApiProperty({ type: String, nullable: true })
  category!: string | null;

  @ApiProperty({ type: [OpeningStockUnitView], description: 'Smallest first.' })
  units!: OpeningStockUnitView[];

  @ApiProperty({
    format: 'uuid',
    description:
      'The unit the sheet starts on: the biggest, because shelves are counted in cartons.',
  })
  defaultUnitId!: string;
}

export class OpeningStockResultView {
  @ApiProperty({ description: 'How many products now have opening stock.' })
  products!: number;

  @ApiProperty({ description: 'How many lines were recorded.' })
  lines!: number;

  @ApiProperty({
    description:
      'What it is all worth, in kobo — the sum of every line’s total.',
  })
  totalValue!: number;
}

/** An opening lot's value before and after a cost correction. */
export class LotCostCorrectionView {
  @ApiProperty({ format: 'uuid' })
  batchId!: string;

  @ApiProperty({ example: 'Rich Nourishing Lotion' })
  productName!: string;

  @ApiProperty({ description: 'What the lot brought in, in counted-in units.' })
  quantity!: number;

  @ApiProperty({ example: 'piece' })
  baseUnitName!: string;

  @ApiProperty({ description: 'The lot’s total before, in minor units.' })
  totalCostBefore!: number;

  @ApiProperty({ description: 'The lot’s total after, rounded once.' })
  totalCostAfter!: number;

  @ApiProperty({
    description: 'False for a preview: nothing was written.',
  })
  saved!: boolean;
}
