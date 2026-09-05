import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';

export class PaymentAllocationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  saleId!: string;

  @ApiProperty({
    example: 1_080_000,
    description:
      'How much of this payment settles that invoice, in kobo. Signed the same way as the payment.',
  })
  @IsInt()
  @NotEquals(0)
  amount!: number;
}

export class CreatePaymentDto {
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
      'Whose account this is. Omit only for a walk-in refund, which must then name its sale in `allocations`.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Which counter or van took the money, for the end-of-shift cash-up. Omit it for a transfer that lands in the bank rather than at a till.',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  /**
   * Signed, in kobo: positive is money received, negative is money handed
   * back. One row per thing that actually happened — a single transfer
   * covering three invoices is one payment with three allocations, not three
   * payments, so it still matches the bank statement.
   */
  @IsMoney({ example: 5_000_000, allowNegative: true })
  amount!: number;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.cash })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({
    example: 'FT26083012345',
    description: 'Transfer or POS slip number, or the cheque number.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional({ example: 'Part payment, balance on Friday.' })
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
  occurredAt?: string;

  @ApiPropertyOptional({
    type: [PaymentAllocationDto],
    description:
      'Which invoices this settles. Omitted, it goes against the oldest outstanding invoices first. Anything left over stays as credit on the customer.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations?: PaymentAllocationDto[];
}
