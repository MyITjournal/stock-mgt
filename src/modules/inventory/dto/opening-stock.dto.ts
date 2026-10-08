import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';

/** The most lines one save may carry — a whole catalog, with room to spare. */
export const MAX_OPENING_LINES = 2000;

/**
 * One line of the opening-stock sheet: this many of this unit, at this cost.
 *
 * **The cost is required**, and per unit because that is what an owner knows
 * ("a carton was ₦14,000"). It becomes an exact total — cost × quantity, both
 * integers — before anything is stored, so §2 holds: totals are stored, never
 * a rounded rate.
 */
export class OpeningStockLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Which option, for a product with options — required then, and never a retired one. Each option is entered once per location (DECISIONS.md §24).',
  })
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Which of the product’s units the quantity is counted in.',
  })
  @IsUUID()
  unitId!: string;

  /**
   * In `unitId`, and it may be a decimal — **6.25 cartons** — so one product
   * is one line rather than cartons plus a "loose" line (2026-10-07). It must
   * come to whole counted-in units: 6.25 cartons of 12 is 75 pieces; 6.1 is
   * refused. Stock is still stored in whole base units; the decimal only
   * travels this far.
   */
  @ApiProperty({
    example: 6.25,
    description:
      'How many, in the chosen unit. Up to three decimal places, and it must come to whole counted-in units.',
  })
  @IsNumber(
    { maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false },
    { message: 'quantity must be a number with at most three decimal places' },
  )
  @Min(0.001)
  @Max(10_000_000)
  quantity!: number;

  @IsMoney({ example: 1_400_000 })
  /**
   * What **one** of `unitId` cost, in kobo — one carton when the line is in
   * cartons. Zero is allowed and means free goods.
   */
  unitCost!: number;

  @ApiPropertyOptional({ format: 'date', example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class OpeningStockDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Where the stock is. The default location when omitted.',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiProperty({ type: [OpeningStockLineDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Fill in at least one line.' })
  @ArrayMaxSize(MAX_OPENING_LINES)
  @ValidateNested({ each: true })
  @Type(() => OpeningStockLineDto)
  lines!: OpeningStockLineDto[];
}

/** A cost for an opening lot, in one of its product's units — checked, not saved. */
export class LotCostPreviewDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Which of the product’s units `unitCost` is for.',
  })
  @IsUUID()
  unitId!: string;

  @IsMoney({ example: 1_243_336 })
  /** What **one** of `unitId` really cost, in kobo. */
  unitCost!: number;
}

/** The same, saved — with the reason, which is required. */
export class CorrectLotCostDto extends LotCostPreviewDto {
  @ApiProperty({
    example: 'Entered at a pack’s cost; it was half a pack.',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @MinLength(3, { message: 'Say why the cost is being corrected.' })
  @MaxLength(500)
  reason!: string;
}
