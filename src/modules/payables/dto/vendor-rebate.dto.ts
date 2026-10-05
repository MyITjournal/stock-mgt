import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';

/**
 * What the owner expects a vendor to credit for a month's buying.
 *
 * Tentative on purpose: the vendor works out the real figure later, and it is
 * entered when the credit lands (`CreditVendorRebateDto`). Whether the month's
 * target was met is the owner's judgement, not a rule here.
 */
export class CreateVendorRebateDto {
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
      'Any instant inside the month the rebate was earned. Snapped to the first of that month in the organization’s timezone, as a purchase target is.',
  })
  @IsDateString()
  period!: string;

  @IsMoney({ example: 120_000_00 })
  @Min(1, { message: 'Enter the rebate you expect, in naira.' })
  /** What the owner expects, in kobo. Tentative until it is credited. */
  expectedAmount!: number;

  @ApiPropertyOptional({ example: 'Met the October lotion target.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/**
 * Only what is expected and the note. The vendor and the month are what the
 * rebate *is*; a wrong one is removed and recorded again.
 */
export class UpdateVendorRebateDto {
  @ApiPropertyOptional({ example: 120_000_00 })
  @IsOptional()
  @IsMoney({ optional: true })
  @Min(1)
  expectedAmount?: number;

  @ApiPropertyOptional({ description: 'Send an empty string to clear it.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** The credit landing on a bill — the real figure, which may differ. */
export class CreditVendorRebateDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The bill the vendor took it off. Must be the same vendor’s, and owe at least this much.',
  })
  @IsUUID()
  billId!: string;

  @IsMoney({ example: 118_500_00 })
  @Min(1)
  /** What was actually credited, in kobo. */
  amount!: number;
}
