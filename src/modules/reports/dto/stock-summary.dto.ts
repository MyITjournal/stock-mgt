import { ApiProperty } from '@nestjs/swagger';
import { PeriodView } from './report.response';

class SummaryProductRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Rich Nourishing Lotion' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: '400ml' })
  size!: string | null;
}

class SummaryUnit {
  @ApiProperty({ example: 'carton' })
  name!: string;

  @ApiProperty({ example: 12 })
  factor!: number;
}

/** One product's period, in base units: opening + delivered − sold ± adjusted = closing. */
export class StockSummaryRow {
  @ApiProperty({ type: () => SummaryProductRef })
  product!: SummaryProductRef;

  @ApiProperty({
    type: () => [SummaryUnit],
    description:
      'The product’s units, smallest first, so a screen can say "6 carton, 3 piece".',
  })
  units!: SummaryUnit[];

  @ApiProperty({
    description:
      'On hand when the period began, plus opening stock entered during it.',
  })
  opening!: number;

  @ApiProperty({
    description: 'Delivered, corrections to deliveries included.',
  })
  delivered!: number;

  @ApiProperty({
    description: 'Sold, less customer returns put back — goods gone.',
  })
  sold!: number;

  @ApiProperty({
    description:
      'Everything else, signed: write-offs, counts, transfers, goods sent back.',
  })
  adjusted!: number;

  @ApiProperty({ description: 'On hand when the period ended.' })
  closing!: number;
}

export class StockSummaryView {
  @ApiProperty({ type: () => PeriodView })
  period!: PeriodView;

  @ApiProperty({
    type: () => [StockSummaryRow],
    description: 'One per product with stock or movement, by name.',
  })
  rows!: StockSummaryRow[];
}
