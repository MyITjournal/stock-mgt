import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Interim shape. Slice 2 replaces this with SKU, category, units of measure and
 * price tiers, and moves `price` to integer minor units.
 */
export class CreateProductDto {
  @ApiProperty({ example: 'Peak Milk 400g' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 2500, description: 'Unit price' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ example: 'Powdered milk, 400g tin' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
