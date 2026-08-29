import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
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

export class GoodsReceiptLineDto {
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
      'The unit the quantities are counted in — the carton, not the piece. Defaults to the base unit.',
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiProperty({
    example: 20,
    minimum: 1,
    description: 'What physically arrived, counted in `unitId`.',
  })
  @IsInt()
  @Min(1)
  quantityReceived!: number;

  @ApiPropertyOptional({
    example: 19,
    minimum: 0,
    description:
      'What the invoice charged for. Lower than quantityReceived when the vendor gave free goods; higher on a short delivery. Defaults to quantityReceived.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantityPaidFor?: number;

  /**
   * The exact invoice total for this line — never a per-unit price. Entering
   * "45,211.11 x 6" loses a kobo before the calculation starts; the implied
   * unit cost is output, not input.
   */
  @IsMoney({ example: 94944900 })
  totalCost!: number;

  @ApiPropertyOptional({
    example: 'LOT-2026-04',
    description: "The vendor's lot number.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lotCode?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2027-03-31T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class CreateGoodsReceiptDto {
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
  supplierId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Where the goods landed. Defaults to the organization’s default location.',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ example: 'INV-88213' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  invoiceNumber?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'When the delivery arrived. Defaults to now; an offline device sends its own clock.',
  })
  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @ApiPropertyOptional({ example: 'Two cartons dented, accepted anyway.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiProperty({ type: [GoodsReceiptLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines!: GoodsReceiptLineDto[];
}
