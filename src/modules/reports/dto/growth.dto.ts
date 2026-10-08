import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Is the business growing (2026-10-08). The service's declared return types,
 * not descriptions of them (DECISIONS.md §17).
 */
export class GrowthQueryDto {
  @ApiPropertyOptional({
    enum: [6, 12],
    description: 'How many months, ending with this one. Six when omitted.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([6, 12])
  months?: number;
}

export class GrowthFiguresView {
  @ApiProperty({ description: 'Tax-exclusive, net of returns.' })
  revenue!: number;

  @ApiProperty()
  grossProfit!: number;

  @ApiProperty({ description: 'Gross profit over revenue, in basis points.' })
  marginBps!: number;

  @ApiProperty()
  operatingProfit!: number;

  @ApiProperty({
    description: 'Received from customers, whatever invoice it settled.',
  })
  collected!: number;

  @ApiProperty({ description: 'Invoices recorded.' })
  sales!: number;

  @ApiProperty({ description: 'Revenue per sale, rounded once.' })
  averageSale!: number;

  @ApiProperty({ description: 'Named customers who bought.' })
  customers!: number;

  @ApiProperty({ description: 'Of those, buying for the first time ever.' })
  newCustomers!: number;
}

/** Each figure's change in basis points; null when there is nothing to compare with. */
export class GrowthChangeView {
  @ApiProperty({ type: Number, nullable: true })
  revenue!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  grossProfit!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  operatingProfit!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  collected!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  sales!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  averageSale!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  customers!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  newCustomers!: number | null;

  @ApiProperty({
    description:
      'The margin’s move in points, as basis points: 250 is from 10.0% to 12.5%.',
  })
  marginPoints!: number;
}

/** This month so far beside the same stretch of last month. */
export class GrowthComparisonView {
  @ApiProperty({ type: String, format: 'date-time' })
  currentFrom!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  currentTo!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  previousFrom!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'The same day of the month and time of day as now, last month — or the end of last month, if it had no such day.',
  })
  previousTo!: Date;

  @ApiProperty({ type: () => GrowthFiguresView })
  current!: GrowthFiguresView;

  @ApiProperty({ type: () => GrowthFiguresView })
  previous!: GrowthFiguresView;

  @ApiProperty({ type: () => GrowthChangeView })
  change!: GrowthChangeView;
}

export class GrowthMonthView {
  @ApiProperty({ example: '2026-10' })
  month!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  from!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  to!: Date;

  @ApiProperty({
    description:
      'This month, so far. Its change is against the same stretch of the month before, never all of it.',
  })
  partial!: boolean;

  @ApiProperty({ type: () => GrowthFiguresView })
  figures!: GrowthFiguresView;

  @ApiProperty({
    type: () => GrowthChangeView,
    description: 'Against the month before it.',
  })
  change!: GrowthChangeView;
}

export class GrowthReportView {
  @ApiProperty({
    type: () => [GrowthMonthView],
    description: 'Oldest first, ending with this month.',
  })
  months!: GrowthMonthView[];
}
