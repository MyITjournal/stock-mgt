import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreatePriceTierDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Wholesale' })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'The tier used when a customer has none assigned. Setting this clears the flag on the previous default.',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdatePriceTierDto extends PartialType(CreatePriceTierDto) {}
