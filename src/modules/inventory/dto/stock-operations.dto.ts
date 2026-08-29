import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockAdjustmentReason } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';

export class CreateAdjustmentDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client-supplied id, so an offline device can mint the row identity itself.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Defaults to the organization’s default location.',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The unit the quantity is counted in. Defaults to the base unit.',
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiProperty({
    example: -3,
    description:
      'Signed, in `unitId`: negative writes stock off, positive brings it on. Never zero.',
  })
  @IsInt()
  @NotEquals(0)
  quantity!: number;

  @ApiProperty({
    enum: StockAdjustmentReason,
    example: StockAdjustmentReason.damage,
    description:
      'Why. Breakage and spoilage are adjustments with a reason, never silent decrements — that is the difference between a known loss and stock that mysteriously never adds up.',
  })
  @IsEnum(StockAdjustmentReason)
  reason!: StockAdjustmentReason;

  @ApiPropertyOptional({ example: 'Crate dropped at the back door.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Write off one specific batch. Omitted, a negative adjustment picks FEFO and a positive one opens a new batch.',
  })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  /**
   * What the stock being brought on is worth, for a positive adjustment that
   * opens a batch. An opening balance entered without this values the stock at
   * nothing, which quietly understates every margin computed from it.
   */
  @IsOptional()
  @IsMoney({ example: 94944900, optional: true })
  totalCost?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ example: 'LOT-2026-04' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lotCode?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'When it happened, by the device clock. Defaults to now; an offline device sends its own.',
  })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({
    description:
      'Record the movement even though stock does not cover it. Owner and manager only, and a forcedReason is required.',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({
    example: 'Sold from the van before the delivery was entered.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  forcedReason?: string;
}

export class CreateTransferDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fromLocationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  toLocationId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The unit the quantity is counted in. Defaults to the base unit.',
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiProperty({ example: 5, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    example: 'Loading Ibrahim’s van for the Tuesday route.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({
    description: 'Owner and manager only, and a forcedReason is required.',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({
    example: 'Van already loaded before the receipt was entered.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  forcedReason?: string;
}
