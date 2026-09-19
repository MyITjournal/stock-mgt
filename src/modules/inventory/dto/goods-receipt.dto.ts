import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import { IsPlausibleOccurrence } from '../../../common/validation/is-occurrence.validator';
import { IsMoney } from '../../../common/money/is-money.validator';
import { MAX_LINES_PER_REQUEST } from '../../../common/pagination/request-limits';
import { DeliveryPaymentDto } from '../../payables/dto/supplier-payment.dto';

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
  @IsPlausibleOccurrence()
  receivedAt?: string;

  @ApiPropertyOptional({ example: 'Two cartons dented, accepted anyway.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /**
   * What the vendor's invoice actually comes to, when it is not the sum of the
   * goods lines.
   *
   * Every delivery raises a bill on `GET /payables`; this is the figure it
   * carries. Left out, it is the line totals added up, which is right for most
   * deliveries. Pass it when the invoice carries something no stock line can
   * hold — a delivery charge, a settlement discount — so that what you owe
   * matches what the vendor's own statement says.
   *
   * It does **not** change what the goods cost. Inventory is valued from the
   * line totals per §2, and a delivery charge is not part of what a carton cost.
   */
  @ApiPropertyOptional({
    example: 19_980_000,
    description:
      'The vendor’s invoice total, if it differs from the sum of the lines. Owner, manager or accountant only.',
  })
  @IsOptional()
  @IsMoney({ example: 19_980_000, optional: true })
  amountDue?: number;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'When you intend to settle this delivery. Optional, and moving it later is expected.',
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  /**
   * Money handed over there and then.
   *
   * "They delivered ₦199,800 of goods and I gave them ₦71,800 on the spot" is
   * one request, not two — the same reason a counter sale banks its own payment
   * (§6). Somebody standing at a delivery with no signal cannot be asked to
   * make two requests that must both land.
   *
   * Omitted, the delivery is recorded as unpaid and the whole amount shows on
   * `GET /payables`. Owner, manager or accountant only.
   */
  @ApiPropertyOptional({
    type: () => DeliveryPaymentDto,
    description:
      'What you paid at the delivery, if anything. Cannot exceed what the delivery is worth.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryPaymentDto)
  payment?: DeliveryPaymentDto;

  @ApiProperty({ type: [GoodsReceiptLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines!: GoodsReceiptLineDto[];
}
