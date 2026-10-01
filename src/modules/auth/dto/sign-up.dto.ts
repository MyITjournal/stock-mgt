import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
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
}
