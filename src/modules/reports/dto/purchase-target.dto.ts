import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';

export class CreatePurchaseTargetDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client-supplied id, so an offline device can mint the row identity itself.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Whose scheme this is. A target is always a vendor’s.',
  })
  @IsUUID()
  supplierId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Target a whole category — "110 cartons of lotions". Covers the named category only, not its children, and only the products in it that carry no target of their own. Exactly one of categoryId or productId.',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Target one SKU, for a vendor who quotas a single product. Exactly one of categoryId or productId.',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({
    example: '2026-09-01T00:00:00.000Z',
    description:
      'Any instant inside the target month. It is snapped to the first of that month in the organization’s timezone, because the vendor’s scheme runs on calendar months rather than a rolling thirty days.',
  })
  @IsISO8601()
  period!: string;

  @ApiProperty({
    example: 110,
    minimum: 1,
    description:
      'How much the vendor expects, in `unitId` if one is given, otherwise in base units.',
  })
  @IsInt()
  @Min(1)
  targetQuantity!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The unit the target was quoted in — "110 cartons". Converted to base units on write using the factor at that time, so redefining a carton later cannot restate a target that was already agreed.',
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsMoney({
    example: 45000000,
    optional: true,
    // Optional because plenty of schemes are written only in cases.
  })
  targetValue?: number;

  @ApiPropertyOptional({ example: 'Q3 scheme, agreed with Chidi.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdatePurchaseTargetDto extends PartialType(
  CreatePurchaseTargetDto,
) {}

export class PurchaseTargetQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({
    example: '2026-09-01T00:00:00.000Z',
    description:
      'Any instant inside the month to report on. Defaults to the current month in the organization’s timezone.',
  })
  @IsOptional()
  @IsISO8601()
  period?: string;
}
