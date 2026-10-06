import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';

/**
 * A vendor's monthly target in money — "₦12M this month" — beside the carton
 * targets. One per vendor per month.
 */
export class CreateMoneyTargetDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional client-supplied id.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  supplierId!: string;

  @ApiProperty({
    format: 'date-time',
    description:
      'Any instant inside the target month. Snapped to the first of that month in the organization’s timezone, as a carton target is.',
  })
  @IsISO8601()
  period!: string;

  @IsMoney({ example: 1_200_000_000 })
  @Min(1, { message: 'Enter the target, in naira.' })
  /** The target in kobo — before VAT when `addsVat`. */
  amount!: number;

  @ApiPropertyOptional({
    default: true,
    description:
      'The vendor adds 7.5% VAT on top of their invoices, so the target is before VAT and invoices count without it.',
  })
  @IsOptional()
  @IsBoolean()
  addsVat?: boolean;

  @ApiPropertyOptional({ example: 'Agreed with the area rep.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** The amount, the VAT choice and the note. The vendor and month are what it is. */
export class UpdateMoneyTargetDto {
  @ApiPropertyOptional({ example: 1_200_000_000 })
  @IsOptional()
  @IsMoney({ optional: true })
  @Min(1)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  addsVat?: boolean;

  @ApiPropertyOptional({ description: 'Send an empty string to clear it.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
