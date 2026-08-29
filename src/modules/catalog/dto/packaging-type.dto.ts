import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePackagingTypeDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client-supplied id, so an offline device can mint the row identity itself.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'pouch' })
  @IsString()
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional({ example: 'Flexible sealed film, e.g. Milo refill' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 10,
    minimum: 0,
    description: 'Display order in pickers. Ties break on name.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdatePackagingTypeDto extends PartialType(
  CreatePackagingTypeDto,
) {}
