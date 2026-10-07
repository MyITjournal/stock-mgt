import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

/** The same five figures in money: minor units, each at its lot's exact cost, rounded once. */
export class StockSummaryValues {
  @ApiProperty({
    description:
      'Stock at the start, and opening stock entered in the period, at cost.',
  })
  opening!: number;

  @ApiProperty({
    description: 'Deliveries at their invoice value, corrections included.',
  })
  delivered!: number;

  @ApiProperty({
    description:
      'What sold, at its lot’s cost today. The profit report uses the cost frozen onto each sale; they differ only where a lot was corrected since.',
  })
  sold!: number;

  @ApiProperty({
    description: 'Write-offs, counts and moves, signed, at cost.',
  })
  adjusted!: number;

  @ApiProperty({ description: 'What is left, at cost — the stock value.' })
  closing!: number;
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

  @ApiPropertyOptional({
    type: () => StockSummaryValues,
    description:
      'The same in money. **Absent** for a role that may not see cost.',
  })
  value?: StockSummaryValues;
}

export class StockSummaryView {
  @ApiProperty({ type: () => PeriodView })
  period!: PeriodView;

  @ApiProperty({
    type: () => [StockSummaryRow],
    description: 'One per product with stock or movement, by name.',
  })
  rows!: StockSummaryRow[];

  @ApiPropertyOptional({
    type: () => StockSummaryValues,
    description:
      'Every product together, summed exactly and rounded once — the closing figure is the stock value. **Absent** for a role that may not see cost.',
  })
  totalValue?: StockSummaryValues;

  @ApiPropertyOptional({
    description:
      'Goods available for sale: opening + delivered at cost, summed exactly and rounded once — the value of all the stock handled in the period. **Absent** for a role that may not see cost.',
  })
  availableValue?: number;
}
