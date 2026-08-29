import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';

export class SaleLineDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The unit being sold — the carton, not the piece. Defaults to the base unit.',
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiProperty({
    example: 2,
    minimum: 1,
    description: 'Counted in `unitId`.',
  })
  @IsInt()
  @Min(1)
  quantity!: number;

  /**
   * The agreed price, when it is not the one on the price list. This is the
   * discount mechanism: a rep who settled on ₦4,900 over the phone types
   * ₦4,900, rather than a percentage nobody can reconcile afterwards.
   *
   * Omitted, the price comes from the customer's tier, falling back to the
   * product's base price scaled by the unit factor.
   */
  @IsOptional()
  @IsMoney({ example: 490000, optional: true })
  unitPrice?: number;
}

export class CreateSaleDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client-supplied id, so an offline device can mint the row identity itself.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Omit for a walk-in paying cash. Their tier decides the prices; without one, the default tier applies.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Where the stock leaves from. Defaults to the organization’s default location.',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  /**
   * What the customer handed over. Defaults to the full total — the counter
   * sale, which is the common case. Zero is a sale on credit.
   */
  @IsOptional()
  @IsMoney({ example: 1080000, optional: true })
  amountPaid?: number;

  @ApiPropertyOptional({ example: 'Delivered with the Tuesday route.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'When the sale happened, by the device clock. Defaults to now; an offline device sends its own.',
  })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiProperty({ type: [SaleLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  lines!: SaleLineDto[];

  @ApiPropertyOptional({
    description:
      'Sell stock the ledger cannot cover. Owner and manager only, and a forcedReason is required.',
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
