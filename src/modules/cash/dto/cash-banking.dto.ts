import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsPlausibleOccurrence } from '../../../common/validation/is-occurrence.validator';
import { IsMoney } from '../../../common/money/is-money.validator';

export const BANKING_DESTINATIONS = ['bank', 'owner'] as const;
export type BankingDestination = (typeof BANKING_DESTINATIONS)[number];

export class CreateCashBankingDto {
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
      'Whose cash this was. Omitted, the person recording it. Staff may only record their own; an owner or manager records for anyone.',
  })
  @IsOptional()
  @IsUUID()
  heldByUserId?: string;

  @IsMoney({ example: 4_850_000 })
  amount!: number;

  /**
   * Said out loud rather than inferred from a missing account: a client that
   * forgot the account would otherwise record cash as handed to the owner,
   * and nobody would notice until the owner said they never got it.
   */
  @ApiProperty({
    enum: BANKING_DESTINATIONS,
    description:
      '`bank`: paid into one of your accounts, named in `bankAccountId`. `owner`: handed to the owner, where the trail ends.',
  })
  @IsIn(BANKING_DESTINATIONS)
  to!: BankingDestination;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required when `to` is `bank`; refused when it is `owner`.',
  })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({
    example: 'Teller 0042117',
    description: 'The deposit slip or transfer reference.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional({ example: 'Monday and Tuesday takings.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'When it was banked, by the device clock. Defaults to now; an offline device sends its own.',
  })
  @IsOptional()
  @IsDateString()
  @IsPlausibleOccurrence()
  occurredAt?: string;
}

export class VoidCashBankingDto {
  /** Required, as on a voided payment: a void with no reason reads as a row quietly disappearing. */
  @ApiProperty({
    example: 'Not on the GTBank statement for the 8th.',
    description: 'Why this money did not arrive where the row says.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
