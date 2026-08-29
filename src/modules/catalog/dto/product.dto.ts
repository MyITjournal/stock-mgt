import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsUUID } from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';

export class ProductUnitInput {
  @ApiProperty({ example: 'carton' })
  @IsString()
  @MaxLength(40)
  name!: string;

  @ApiProperty({
    example: 24,
    minimum: 1,
    description:
      'How many base units this contains. Exactly one unit must have factor 1, and that one is the base.',
  })
  @IsInt()
  @Min(1)
  factor!: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Pre-selected when selling this product.',
  })
  @IsOptional()
  @IsBoolean()
  isDefaultSelling?: boolean;
}

export class CreateProductDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client-supplied id, so an offline device can mint the row identity itself.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({
    example: 'PEAK-400G',
    description: 'Generated from the name when omitted.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string;

  @ApiProperty({ example: 'Peak Milk 400g' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'Powdered milk, 400g tin' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "Physical form of the base unit, from the organization's packaging types. Milo 400g and 800g are different products, both pouches.",
  })
  @IsOptional()
  @IsUUID()
  packagingTypeId?: string;

  @IsMoney({ example: 250000 })
  basePrice!: number;

  @IsOptional()
  @IsMoney({ example: 200000, optional: true })
  costPrice?: number;

  @ApiPropertyOptional({
    example: 750,
    description: 'VAT rate in basis points. 750 = 7.5%.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  taxRateBps?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  trackStock?: boolean;

  @ApiProperty({
    type: [ProductUnitInput],
    description:
      'The packaging hierarchy. Exactly one unit must have factor 1 (the base unit); stock is recorded in that unit.',
    example: [
      { name: 'piece', factor: 1, isDefaultSelling: true },
      { name: 'carton', factor: 24 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductUnitInput)
  units!: ProductUnitInput[];
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class SetProductPriceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tierId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  unitId!: string;

  @IsMoney({
    example: 5400000,
    // Deliberately not derived from basePrice: a carton is cheaper per piece.
  })
  price!: number;
}
