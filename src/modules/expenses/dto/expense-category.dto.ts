import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateExpenseCategoryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client-supplied id, so an offline device can mint the row identity itself.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'diesel and power' })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: 'Generator diesel and the NEPA bill.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 30,
    minimum: 0,
    description: 'Display order in pickers. Ties break on name.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateExpenseCategoryDto extends PartialType(
  CreateExpenseCategoryDto,
) {}
