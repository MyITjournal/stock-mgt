import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Sign in with an email **or** a username.
 *
 * Owners have an email. Cashiers usually do not — that is the whole reason
 * `username` exists — so the login form has to accept either without making the
 * person choose which kind of account they have.
 *
 * Both are optional at the DTO level and exactly one is required by the service,
 * because "you must send one of these two" is a rule class-validator states
 * clumsily and an error message states well.
 */
export class LoginDto {
  @ApiPropertyOptional({
    example: 'owner@example.com',
    description: 'For an owner or anyone with a real address.',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'amina@adebayo-stores',
    description:
      'For staff created by an owner. Qualified by the shop, so two businesses can each have an Amina. Nothing is ever emailed to it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  username?: string;

  @ApiProperty({ example: 'correct-horse-battery' })
  @IsString()
  password!: string;
}
