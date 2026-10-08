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
import { MAX_IMPORT_ROWS, MAX_IMPORT_UNITS } from '../product-import';

/** One of a row's bigger units, every cell as text. */
export class ImportUnitDto {
  @ApiPropertyOptional({
    example: '1/2 carton',
    description:
      'A name like "1/2 carton" is a portion of another unit in the row, and its count may be left empty.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  @ApiPropertyOptional({
    example: '6',
    description: 'How many counted-in units it holds.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  count?: string;

  @ApiPropertyOptional({ example: '29,900' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  price?: string;
}

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

  @ApiPropertyOptional({
    type: () => [ImportUnitDto],
    description:
      'Unit 2, Unit 3, … in column order. A unit with a price is sold at the till; one without is counted only.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMPORT_UNITS, {
    message: `A product can have up to ${MAX_IMPORT_UNITS + 1} units in one row.`,
  })
  @ValidateNested({ each: true })
  @Type(() => ImportUnitDto)
  units?: ImportUnitDto[];

  @ApiPropertyOptional({
    example: '6154000000005',
    description:
      'For the counted-in unit — of this row’s option, when it names one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  barcode?: string;

  @ApiPropertyOptional({
    example: 'Flavour',
    description:
      'What the options differ by: "Flavour", or "Flavour / Pack size". Blank is "Option".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  optionType?: string;

  @ApiPropertyOptional({
    example: 'Chicken',
    description:
      'This row’s option — "Chicken", or "Chicken / 70g". Rows with the same name and size, each with an option, are one product with options: the first row’s units and prices are the product’s, and a later row’s price that differs is that option’s own.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  option?: string;
}

export class ImportProductsDto {
  @ApiProperty({ type: [ImportRowDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'The file has no rows to import.' })
  @ArrayMaxSize(MAX_IMPORT_ROWS, {
    message: `One file can hold up to ${MAX_IMPORT_ROWS} rows. Split it into smaller files.`,
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
