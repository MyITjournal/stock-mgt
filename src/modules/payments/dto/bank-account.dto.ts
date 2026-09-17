import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBankAccountDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client-supplied id, so an offline device can mint the row identity itself.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    example: 'Guaranty Trust Bank',
    description: 'As the customer would recognise it on their own banking app.',
  })
  @IsString()
  @MaxLength(120)
  bankName!: string;

  @ApiProperty({
    example: 'Adebayo Stores Limited',
    description:
      'The name on the account. A customer transferring money sees this and needs it to match what the invoice told them.',
  })
  @IsString()
  @MaxLength(200)
  accountName!: string;

  @ApiProperty({
    example: '0123456789',
    description: 'Digits only. Spaces and dashes are stripped before storing.',
  })
  @IsString()
  @MaxLength(34)
  @Matches(/^[\d\s-]+$/, {
    message: 'accountNumber must contain only digits, spaces or dashes',
  })
  accountNumber!: string;

  @ApiPropertyOptional({
    example: '058',
    description:
      'The bank’s own code, if you know it. Used later to match a statement pulled through a bank API back to this account.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankCode?: string;

  @ApiPropertyOptional({
    description:
      'Pre-selected when recording a payment, and printed first on an invoice. Setting a new default clears the old one.',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({
    description:
      'Closed accounts stay on past payments but stop being offered for new ones.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: 'POS settlement lands here.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateBankAccountDto extends PartialType(CreateBankAccountDto) {}
