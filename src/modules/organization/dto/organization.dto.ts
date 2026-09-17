import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

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
}
