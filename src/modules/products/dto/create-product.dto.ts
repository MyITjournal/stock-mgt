import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';

/**
 * Interim shape. The catalog branch replaces this with SKU, category, units of
 * measure and price tiers.
 */
export class CreateProductDto {
  @ApiProperty({ example: 'Peak Milk 400g' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsMoney({ example: 250000 })
  price!: number;

  @ApiPropertyOptional({ example: 'Powdered milk, 400g tin' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
