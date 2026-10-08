import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';

/** One delivery line's true figures. */
export class TrueLineFiguresDto {
  @ApiProperty({ format: 'uuid', description: 'The delivery line.' })
  @IsUUID()
  lineId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The product that really arrived, when the line was entered as the wrong one (2026-10-07). Its stock goes in and the recorded product’s comes out; the figures below are in this product’s base units. Omitted when the product was right.',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The option that really arrived (2026-10-08). Omitted when the option was right. Named alone, it moves the stock to that option on the same lot, its cost untouched; with productId, it is the right product’s option. Never a retired option.',
  })
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @ApiProperty({
    example: 91,
    description:
      'What really arrived, in base units — 6½ cartons of 14 is 91. Zero when none of it came, and then the paid-for and value are zero too.',
  })
  @IsInt()
  @Min(0, { message: 'What arrived cannot be less than nothing.' })
  received!: number;

  @ApiProperty({
    example: 84,
    description:
      'What was really paid for, in base units. The rest is free goods.',
  })
  @IsInt()
  @Min(0)
  paidFor!: number;

  @IsMoney({ example: 98_000_00 })
  /** The line's true invoice value, in kobo. */
  totalCost!: number;
}

/**
 * Putting a recorded delivery right: the true figures for the lines that were
 * wrong, and why. The stock difference, the lot, the line and the bill all
 * follow; the figures before are kept.
 */
export class CorrectDeliveryDto {
  @ApiProperty({ example: 'Miscounted: 6½ cartons arrived, not 7.' })
  @IsString()
  @MinLength(3, { message: 'Say what was wrong — a few words will do.' })
  @MaxLength(500)
  reason!: string;

  @ApiProperty({ type: [TrueLineFiguresDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TrueLineFiguresDto)
  lines!: TrueLineFiguresDto[];

  @ApiPropertyOptional({
    description:
      'Record it even though fewer arrived than have already been sold from the delivery — owner or manager, with forcedReason.',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  forcedReason?: string;
}
