import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateStocktakeDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client-supplied id, so an offline device can mint the row identity itself.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Which shelves are being counted. Defaults to the organization’s default location.',
  })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ example: 'Month-end count, main store.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CountLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({
    example: 182,
    description:
      'What was actually on the shelf, in **base units** — the same unit the ledger counts in.',
  })
  @IsInt()
  @Min(0)
  countedQuantity!: number;

  @ApiPropertyOptional({ example: 'Two tins dented, left on the shelf.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CountLinesDto {
  @ApiProperty({
    type: [CountLineDto],
    description:
      'Many at once, because a device that counted a shelf offline syncs the whole sheet in one request. Counting a product twice replaces the earlier line.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CountLineDto)
  lines!: CountLineDto[];
}
