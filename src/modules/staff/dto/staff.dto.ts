import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipStatus, OrgRole } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
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

export class StaffHoursDto {
  @ApiPropertyOptional({
    example: 360,
    description:
      'This person’s own start time, in minutes past midnight. **Null clears it**, and they go back to following the business hours.',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  opensAt?: number | null;

  @ApiPropertyOptional({
    example: 720,
    description: 'Their own finish time. Must be later than `opensAt`.',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  closesAt?: number | null;

  @ApiPropertyOptional({
    example: [6],
    description:
      'Days this person works, 0 = Sunday. An **empty array** means they follow the business. `[6]` is Saturdays only.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays?: number[];

  @ApiPropertyOptional({
    description:
      'Exempt from hours entirely — the manager doing a month-end count, or the storekeeper meeting a lorry at nine at night. Owners are exempt without this.',
  })
  @IsOptional()
  @IsBoolean()
  ignoresWorkingHours?: boolean;
}

export class UpdateStaffDto extends StaffHoursDto {
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
