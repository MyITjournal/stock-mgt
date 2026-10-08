import { ApiProperty } from '@nestjs/swagger';
import { BarcodeSymbology } from '@prisma/client';

export class ImportUnitView {
  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'How many counted-in units it holds.' })
  factor!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Its price in kobo, VAT included. For the counted-in unit this is the base price.',
  })
  price!: number | null;

  @ApiProperty()
  isBase!: boolean;

  @ApiProperty({ description: 'Whether the till will offer it.' })
  isSellable!: boolean;

  @ApiProperty({ description: 'Whether the till picks it first.' })
  isDefaultSelling!: boolean;
}

export class ImportCategoryView {
  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Created (or brought back) by this import.' })
  isNew!: boolean;
}

export class ImportBarcodeView {
  @ApiProperty()
  code!: string;

  @ApiProperty({ enum: BarcodeSymbology, enumName: 'BarcodeSymbology' })
  symbology!: BarcodeSymbology;
}

export class ImportProductView {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty({ type: String, nullable: true })
  size!: string | null;

  @ApiProperty({ type: ImportCategoryView, nullable: true })
  category!: ImportCategoryView | null;

  @ApiProperty({ type: [ImportUnitView] })
  units!: ImportUnitView[];

  @ApiProperty({ type: ImportBarcodeView, nullable: true })
  barcode!: ImportBarcodeView | null;
}

export class ImportRowView {
  @ApiProperty({ description: 'The row number in the spreadsheet.' })
  line!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    enum: ['add', 'skip', 'error'],
    description:
      '`add` will be (or was) created, `skip` is already in the catalog, `error` needs fixing in the file.',
  })
  status!: 'add' | 'skip' | 'error';

  @ApiProperty({
    type: [String],
    description:
      'What is wrong for `error`, why for `skip`, and warnings worth reading for `add`.',
  })
  messages!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Chicken',
    description:
      'The option this row adds. Rows with the same name and size and an Option filled in are one product with options; each row’s units show what that option sells at.',
  })
  option!: string | null;

  @ApiProperty({ type: ImportProductView, nullable: true })
  product!: ImportProductView | null;
}

export class ImportReportView {
  @ApiProperty({ description: 'False for a preview; true once saved.' })
  saved!: boolean;

  @ApiProperty({
    description:
      'Products added. A product with options is several rows, and counts once.',
  })
  adding!: number;

  @ApiProperty({ description: 'Options added, across those products.' })
  options!: number;

  @ApiProperty()
  skipped!: number;

  @ApiProperty()
  errors!: number;

  @ApiProperty({
    type: [String],
    description: 'Categories the import creates or brings back.',
  })
  newCategories!: string[];

  @ApiProperty({ type: [ImportRowView] })
  rows!: ImportRowView[];
}
