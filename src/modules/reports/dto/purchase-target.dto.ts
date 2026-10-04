import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A vendor's quota for one category in one month, in cartons.
 *
 * No product, no unit, no money: a target is "112 cartons of lotion", and any
 * lotion counts (DECISIONS.md §12, 2026-10-04). Each product's carton is its
 * biggest unit, so there is nothing to choose.
 */
export class CreatePurchaseTargetDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client-supplied id, so an offline device can mint the row identity itself.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ format: 'uuid', description: 'Whose scheme this is.' })
  @IsUUID()
  supplierId!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'The category the cartons are counted in. Every product filed under it counts; its children do not.',
  })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({
    example: '2026-10-01T00:00:00.000Z',
    description:
      'Any instant inside the target month. It is snapped to the first of that month in the organization’s timezone, because the vendor’s scheme runs on calendar months rather than a rolling thirty days.',
  })
  @IsISO8601()
  period!: string;

  @ApiProperty({
    example: 112,
    minimum: 1,
    description:
      "Cartons. Each product's carton is its biggest unit, so a carton of 12 and a carton of 24 each count as one.",
  })
  @IsInt({ message: 'A target is a whole number of cartons.' })
  @Min(1)
  @Max(1_000_000)
  targetCartons!: number;

  @ApiPropertyOptional({ example: 'Promo: one free carton in every twenty' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/**
 * Only the number and the note change. The vendor, the category and the month
 * are what the target *is* — changing them would silently restate what a past
 * month's figure meant — so they are not here, and the global ValidationPipe
 * refuses them by name.
 */
export class UpdatePurchaseTargetDto {
  @ApiPropertyOptional({ example: 120, minimum: 1, description: 'Cartons.' })
  @IsOptional()
  @IsInt({ message: 'A target is a whole number of cartons.' })
  @Min(1)
  @Max(1_000_000)
  targetCartons?: number;

  @ApiPropertyOptional({
    description: 'An empty string clears it; leaving it out leaves it alone.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class PurchaseTargetQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({
    example: '2026-10-01T00:00:00.000Z',
    description:
      'Any instant inside the month to report on. Defaults to the current month in the organization’s timezone.',
  })
  @IsOptional()
  @IsISO8601()
  period?: string;
}
