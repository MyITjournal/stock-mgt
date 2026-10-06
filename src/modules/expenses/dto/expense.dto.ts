import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsPlausibleOccurrence } from '../../../common/validation/is-occurrence.validator';
import { IsMoney } from '../../../common/money/is-money.validator';

export class CreateExpenseDto {
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
  categoryId!: string;

  @IsMoney({ example: 1500000 })
  amount!: number;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.cash })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  /**
   * Required, and typed (2026-10-06): the landlord, the mechanic, a member of
   * staff. "Nobody in particular" was the default and told nobody anything.
   * Vendors are not picked here — paying a vendor for stock is a bill, never
   * an expense (§16).
   */
  @ApiProperty({ example: 'Mr Okafor (landlord)', maxLength: 120 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Say who was paid.' })
  @MaxLength(120)
  paidTo!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Who was paid, when it happens to be a supplier on file. Kept for older clients; the dashboard asks for `paidTo` instead.',
  })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ example: 'Receipt 4471' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional({ example: 'Diesel for the Tuesday route.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Defaults to now; an offline device sends its own clock.',
  })
  @IsOptional()
  @IsDateString()
  @IsPlausibleOccurrence()
  occurredAt?: string;
}

export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}
