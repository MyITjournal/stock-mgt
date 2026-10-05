import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
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

  @ApiProperty({
    format: 'uuid',
    description: 'Which of the product’s units the quantity is counted in.',
  })
  @IsUUID()
  unitId!: string;

  @ApiProperty({ example: 14, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  quantity!: number;

  @IsMoney({ example: 1_400_000 })
  /** What one of `unitId` cost, in kobo. Zero is allowed and means free goods. */
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
