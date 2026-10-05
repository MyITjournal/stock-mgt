import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import { MAX_IMPORT_ROWS } from '../product-import';

/**
 * One spreadsheet row, every cell as text.
 *
 * Text on purpose, numbers included: the server reads a price, so a browser
 * never decides what `14,500` means, and the preview and the save read it the
 * same way. Lengths here are only a ceiling on what is accepted at all — the
 * real limits are checked per row, so they come back as a message on that row
 * instead of refusing the whole file.
 */
export class ImportRowDto {
  @ApiPropertyOptional({
    example: 2,
    description: 'The row number in the spreadsheet, echoed back in messages.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  line?: number;

  @ApiPropertyOptional({ example: 'Peak 14g' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  @ApiPropertyOptional({ example: '14g' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  size?: string;

  @ApiPropertyOptional({
    example: 'Milk',
    description: 'By name. One that does not exist yet is created.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  category?: string;

  @ApiPropertyOptional({
    example: 'sachet',
    description:
      'What stock is counted in — the base unit. Blank means "piece".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  countedIn?: string;

  @ApiPropertyOptional({
    example: '100',
    description: 'Price of one counted-in unit, in naira, VAT included.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  price?: string;

  @ApiPropertyOptional({ example: 'roll' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  unit2?: string;

  @ApiPropertyOptional({
    example: '10',
    description: 'How many counted-in units one of unit 2 holds.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  unit2Count?: string;

  @ApiPropertyOptional({ example: '950' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  unit2Price?: string;

  @ApiPropertyOptional({ example: 'carton' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  unit3?: string;

  @ApiPropertyOptional({ example: '160' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  unit3Count?: string;

  @ApiPropertyOptional({ example: '14,500' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  unit3Price?: string;

  @ApiPropertyOptional({
    example: '6154000000005',
    description: 'For the counted-in unit.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  barcode?: string;
}

export class ImportProductsDto {
  @ApiProperty({ type: [ImportRowDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'The file has no rows to import.' })
  @ArrayMaxSize(MAX_IMPORT_ROWS, {
    message: `One file can hold up to ${MAX_IMPORT_ROWS} products. Split it into smaller files.`,
  })
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];

  @ApiPropertyOptional({
    description:
      'Check every row and say what would happen, saving nothing. The preview.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
