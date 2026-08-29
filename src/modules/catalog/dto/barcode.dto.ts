import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BarcodeSymbology } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateBarcodeDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Which unit this code identifies. The carton and the piece carry different barcodes.',
  })
  @IsUUID()
  unitId!: string;

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
