import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessType } from '@prisma/client';
import {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '../../../common/money/currencies';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsTimeZone,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignUpDto {
  @ApiProperty({
    description: 'The shop or business name.',
    example: 'Adebayo Stores',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  organizationName!: string;

  @ApiProperty({ example: 'Ade' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Bayo' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  /**
   * Letters, digits, dot, dash and underscore — no `@`, which is what keeps a
   * username distinguishable from an email at the login box, and no spaces,
   * which nobody can retype reliably from a scrap of paper.
   *
   * Lowercased by the service, so `Adebayo` and `adebayo` are the same person
   * rather than two accounts one letter apart.
   */
  @ApiProperty({
    description:
      'What you will sign in with. Letters, numbers, dot, dash and underscore.',
    example: 'adebayo',
    minLength: 3,
    maxLength: 40,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message:
      'A username can use letters, numbers, dot, dash and underscore — nothing else.',
  })
  username!: string;

  @ApiProperty({ example: 'correct-horse-battery', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'A password needs at least 8 characters.' })
  @MaxLength(128)
  password!: string;

  /**
   * Optional, and the one thing on this form worth filling in.
   *
   * Nothing is sent to it today — this instance has no mail provider, which is
   * the whole reason username sign-up exists. It is stored so that the day one
   * is configured, this person can reset their own password instead of asking
   * us to. Somebody who leaves it blank never can.
   */
  @ApiPropertyOptional({
    description:
      'Optional. Nothing is sent to it now; it is what will let you reset your own password later.',
    example: 'owner@example.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'That does not look like an email address.' })
  @MaxLength(255)
  email?: string;

  /**
   * Optional on the wire so an older client that never asks still signs up —
   * it gets `mixed`, which is how every shop behaved before the question
   * existed. The sign-up screen always sends it.
   */
  @ApiPropertyOptional({
    enum: BusinessType,
    enumName: 'BusinessType',
    default: BusinessType.mixed,
    description:
      'What kind of trading the shop does. Sets the price lists it starts with and how new products begin; it locks nothing, and the owner can change it later.',
  })
  @IsOptional()
  @IsEnum(BusinessType, {
    message: 'Choose retail, wholesale or both.',
  })
  businessType?: BusinessType;

  /**
   * The currency the shop keeps its books in. Chosen once: it can be changed in
   * Settings only until something with money in it is recorded (§2).
   */
  @ApiPropertyOptional({
    enum: SUPPORTED_CURRENCIES,
    default: DEFAULT_CURRENCY,
    description:
      'The currency every price and payment in this shop is in. One per shop; it can be changed in Settings until the first price, sale, delivery, payment or expense is recorded.',
  })
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES, {
    message: `Choose one of ${SUPPORTED_CURRENCIES.join(', ')}.`,
  })
  currency?: SupportedCurrency;

  /**
   * Sent by the sign-up screen from the browser's own clock, never asked: an
   * owner signing up in Accra is on Accra time whatever currency they chose.
   */
  @ApiPropertyOptional({
    example: 'Africa/Lagos',
    description:
      "The owner's time zone, as the browser reports it. Every report period resolves in it. Omitted, the currency's home zone is used.",
  })
  @IsOptional()
  @IsTimeZone({ message: 'That is not a time zone this server knows.' })
  timezone?: string;
}
