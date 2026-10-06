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

  @ApiProperty({
    example: 91,
    description:
      'What really arrived, in base units — 6½ cartons of 14 is 91. At least one: a line cannot be corrected to nothing, because a lot that received nothing has no cost per piece.',
  })
  @IsInt()
  @Min(1, { message: 'At least one piece must have arrived on a line.' })
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
