import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { BarcodeSymbology } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
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

/**
 * A tier price for one unit, set as the product is created.
 *
 * Keyed by unit **name**, not id: the units are being created by the same
 * request, so the caller has no ids to point at yet.
 */
export class ProductPriceInput {
  @ApiProperty({
    example: 'carton',
    description: 'Which unit this price is for, by name, from `units` above.',
  })
  @IsString()
  @MaxLength(40)
  unit!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "Defaults to the organization's default tier, which is what a walk-in gets.",
  })
  @IsOptional()
  @IsUUID()
  tierId?: string;

  @IsMoney({
    example: 5400000,
    // Deliberately not derived from basePrice: a carton is cheaper per piece.
  })
  price!: number;
}

/** A barcode attached as the product is created. Keyed by unit name, as above. */
export class ProductBarcodeInput {
  @ApiProperty({
    example: 'carton',
    description: 'Which unit carries this code, by name, from `units` above.',
  })
  @IsString()
  @MaxLength(40)
  unit!: string;

  @ApiPropertyOptional({
    example: '5901234123457',
    description:
      'Omit to generate an internal EAN-13 for goods that arrive without a barcode.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @ApiPropertyOptional({
    enum: BarcodeSymbology,
    description: 'Detected from the code shape when omitted.',
  })
  @IsOptional()
  @IsEnum(BarcodeSymbology)
  symbology?: BarcodeSymbology;

  @ApiPropertyOptional({ description: 'Use this code on printed labels.' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
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

  @ApiPropertyOptional({
    example: 240,
    description:
      'Reorder once stock on hand falls to or below this, in **base units**. Omit it and the product is simply left off the low-stock list; set it to 0 to be told only when it runs out entirely.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  reorderPoint?: number;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/peak-milk-400g.jpg',
    description:
      'A picture of the product. Set it directly when the image is already hosted somewhere; use POST /products/:id/image to upload one instead.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

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

  @ApiPropertyOptional({
    type: [ProductPriceInput],
    description:
      'Tier prices for units that are not priced by scaling the base price. Without one, a unit falls back to `basePrice x factor` — which is right for a sachet against a piece and wrong for a carton, since a carton is cheaper per piece. On PATCH, the listed rows are upserted and unlisted ones are left alone.',
    example: [{ unit: 'carton', price: 5400000 }],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductPriceInput)
  prices?: ProductPriceInput[];

  @ApiPropertyOptional({
    type: [ProductBarcodeInput],
    description:
      'Barcodes to attach. Codes belong to units, not products: the carton and the piece scan differently. Use POST /products/:id/barcodes to add one to a product that already exists.',
    example: [{ unit: 'carton', code: '5901234123457' }],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductBarcodeInput)
  barcodes?: ProductBarcodeInput[];
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}
