import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PERIOD_NAMES } from '../period';
import type { PeriodName } from '../period';

const GROUPINGS = [
  'day',
  'product',
  'category',
  'customer',
  'location',
  'rep',
  'tier',
] as const;

export class PeriodQueryDto {
  @ApiPropertyOptional({
    enum: PERIOD_NAMES as unknown as string[],
    default: 'month',
    description:
      'A named window, resolved in the organization’s timezone. Ignored when `from`/`to` are given.',
  })
  @IsOptional()
  @IsIn(PERIOD_NAMES as unknown as string[])
  period?: PeriodName;

  @ApiPropertyOptional({
    format: 'date',
    description:
      'Start of a custom range, read as a local date. Needs `to` as well.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    description:
      'End of a custom range, read as a local date and **inclusive** of that whole day.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class SalesReportQueryDto extends PeriodQueryDto {
  @ApiPropertyOptional({
    enum: GROUPINGS as unknown as string[],
    default: 'day',
    description:
      'Which dimension to slice by. `product` and `category` group invoice lines; everything else groups whole invoices.',
  })
  @IsOptional()
  @IsIn(GROUPINGS as unknown as string[])
  groupBy?: (typeof GROUPINGS)[number];
}

export class ProductReportQueryDto extends PeriodQueryDto {
  @ApiPropertyOptional({
    default: 30,
    description:
      'How long a product must have gone unsold to count as dead stock.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  staleDays?: number;
}

export class ValuationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class ExpiryQueryDto {
  @ApiPropertyOptional({
    default: 30,
    description:
      'How far ahead to look, in days. Anything already expired is included.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  withinDays?: number;
}
