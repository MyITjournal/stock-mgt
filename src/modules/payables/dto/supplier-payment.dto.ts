import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';
import { IsPlausibleOccurrence } from '../../../common/validation/is-occurrence.validator';

/**
 * Money paid out to a vendor, against exactly one bill.
 *
 * No `allocations` array, unlike the customer side. Vendors here are paid on
 * delivery or against one specific supply, so the bill is named directly. A
 * lump sum settling three deliveries would need allocations, and that is a
 * migration on the day somebody actually does it.
 */
export class CreateSupplierPaymentDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client-supplied id, so an offline device can mint the row identity itself.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The bill this settles, in whole or in part.',
  })
  @IsUUID()
  billId!: string;

  @ApiProperty({
    example: 7_180_000,
    description:
      'In kobo. May be less than the balance — part-payment is ordinary. Paying more than is outstanding is refused with a 409.',
  })
  @IsMoney({ example: 7_180_000 })
  amount!: number;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.cash })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Which of your accounts the money left from. Required for `transfer` and `pos`, and must be omitted for `cash` — the same rule as money coming in, because a wrong account only surfaces at reconciliation.',
  })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ example: 'FT26091912345' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional({ example: 'Paid at the depot on collection.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'When the money moved, by the device clock. Defaults to now; an offline device sends its own.',
  })
  @IsOptional()
  @IsDateString()
  @IsPlausibleOccurrence()
  occurredAt?: string;
}

/**
 * Money handed over at the moment a delivery is recorded.
 *
 * The same shape minus the bill, because the bill is the one being created by
 * the request carrying this. It exists so that "they delivered 199,800 of goods
 * and I gave them 71,800 there and then" is **one** request — the same reasoning
 * that makes a counter sale bank its own payment (§6), and the same reason it
 * matters: somebody standing at a delivery with no signal cannot be asked to
 * make two requests that must both land.
 */
export class DeliveryPaymentDto {
  @IsMoney({ example: 7_180_000 })
  amount!: number;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.cash })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ example: 'FT26091912345' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

/**
 * Voiding says the payment never happened — a mis-key, the wrong vendor.
 *
 * The reason is required and stored, exactly as it is for a customer payment:
 * an unexplained void is indistinguishable from a covered-up one.
 */
export class VoidSupplierPaymentDto {
  @ApiProperty({
    example: 'Keyed against the wrong vendor.',
    minLength: 3,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
