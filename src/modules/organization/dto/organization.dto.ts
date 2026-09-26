import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * The letterhead, and nothing else.
 *
 * Deliberately not a general "update the organization" DTO: `currency`,
 * `timezone` and `nextSaleNumber` are load-bearing — periods resolve in the
 * timezone (§12) and invoice numbering must not be rewound — so they are not
 * editable through a profile screen.
 */
export class UpdateOrganizationDto {
  @ApiPropertyOptional({ example: 'Adebayo Stores Limited' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: '12 Oba Akran Avenue, Ikeja, Lagos' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  phone?: string;

  @ApiPropertyOptional({ example: 'sales@adebayostores.ng' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional({
    example: '01234567-0001',
    description:
      'Tax Identification Number, printed on the invoice where a customer’s accounts need it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  taxId?: string;

  @ApiPropertyOptional({
    example: 'RC 1234567',
    description: 'CAC registration number.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  rcNumber?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/adebayo-stores-logo.png',
    description:
      'Shown on the letterhead. A URL rather than an upload, so a business already hosting its brand assets is not forced through ours.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  logoUrl?: string;

  @ApiPropertyOptional({
    example: 480,
    minimum: 0,
    maximum: 1440,
    description:
      'When staff may sign in, as minutes past midnight in your timezone. 480 is 08:00. Owners are never locked out.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  opensAt?: number;

  @ApiPropertyOptional({
    example: 1140,
    minimum: 0,
    maximum: 1440,
    description:
      'Must be later than `opensAt` — no window crosses midnight, because there is no night shift yet. 1140 is 19:00.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  closesAt?: number;

  /**
   * **At least one day, and that is a safety rule rather than tidiness.**
   *
   * An empty array here does not mean "every day" — it means *no* day is a
   * working day, so `isWithinWorkingHours` refuses every sign-in and the whole
   * shop is locked out of its own system. Owners are exempt and could put it
   * back (§9), but every cashier, storekeeper and rep would be shut out with
   * nothing on screen explaining why.
   *
   * Note this is the opposite of `StaffHoursDto.workingDays`, where an empty
   * array is meaningful and means "follow the business". The difference is that
   * a membership has something to fall back to and the organization does not.
   */
  @ApiPropertyOptional({
    example: [1, 2, 3, 4, 5, 6],
    description:
      'Which days you open, 0 = Sunday. All seven by default; drop 0 if you close on Sundays. At least one day is required — an empty list would lock every member of staff out.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, {
    message:
      'Choose at least one working day. A business open on no days locks every member of staff out.',
  })
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays?: number[];
}
