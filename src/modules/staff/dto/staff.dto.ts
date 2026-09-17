import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipStatus, OrgRole } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateStaffDto {
  @ApiProperty({ example: 'Amina' })
  @IsString()
  @MaxLength(80)
  firstName!: string;

  @ApiPropertyOptional({ example: 'Bello' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({
    example: 'amina',
    description:
      'What this person signs in with. Letters, digits, dots, dashes and underscores. Stored qualified by your shop — "amina" becomes `amina@your-shop-slug` — so two businesses can each have an Amina. Give this **or** an email.',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      'username may contain only letters, digits, dots, dashes and underscores',
  })
  username?: string;

  @ApiPropertyOptional({
    example: 'amina@example.com',
    description:
      'Only for staff who actually have an address. Without one they cannot reset their own password — you reset it for them.',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: 'first-password-change-it',
    description:
      'You set this and tell them. There is no email to send it to for most staff.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @ApiProperty({
    enum: OrgRole,
    example: OrgRole.sales_rep,
    description:
      'What they may do here. `owner` is grantable — a business with one owner is one lost phone away from nobody being able to manage staff.',
  })
  @IsEnum(OrgRole)
  role!: OrgRole;
}

export class UpdateStaffDto {
  @ApiPropertyOptional({ enum: OrgRole })
  @IsOptional()
  @IsEnum(OrgRole)
  role?: OrgRole;

  @ApiPropertyOptional({
    enum: [MembershipStatus.active, MembershipStatus.suspended],
    description:
      'Suspending takes effect on their very next request, not when their token expires. Reactivating needs a free seat.',
  })
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}

export class ResetStaffPasswordDto {
  @ApiProperty({ example: 'a-new-password' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
