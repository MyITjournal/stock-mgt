import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
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

/**
 * Money taken at the point of sale, so a counter sale is one round trip
 * rather than two — which matters when the device is offline and syncing
 * later. Anything paid afterwards goes through `POST /payments`.
 */
export class SalePaymentDto {
  @IsMoney({ example: 1080000 })
  amount!: number;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.cash })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ example: 'FT26083012345' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
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

  @ApiPropertyOptional({
    type: () => SalePaymentDto,
    description:
      'What the customer handed over, recorded as a payment against this sale. Omitted, the sale is paid in full in cash — the counter sale. Pass `{ "amount": 0 }` for a sale on credit.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SalePaymentDto)
  payment?: SalePaymentDto;

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

  /**
   * Why this customer is being given credit while they still owe.
   *
   * Selling on credit to someone with an unsettled balance is refused with a
   * 409: what is owed is meant to be cleared first. Supplying a reason *is* the
   * override — there is no separate boolean, so an override can never be
   * recorded without one — and only an owner or manager may use it.
   */
  @ApiPropertyOptional({
    example: 'Owner approved; paying both invoices on Friday.',
    description:
      'Overrides the refusal to sell on credit to a customer who already owes. Owner or manager only, and recorded on the sale.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  creditOverrideReason?: string;
}
