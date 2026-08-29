import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CategoryService } from './category.service';
import { PriceTierService } from './price-tier.service';
import { ProductService } from './product.service';
import { BarcodeService } from './barcode.service';
import { ScanService } from './scan.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { CreatePriceTierDto, UpdatePriceTierDto } from './dto/price-tier.dto';
import {
  CreateProductDto,
  SetProductPriceDto,
  UpdateProductDto,
} from './dto/product.dto';
import { CreateBarcodeDto } from './dto/barcode.dto';

/** Editing the catalog is a management job; every member may read it. */
const CATALOG_EDITORS = [OrgRole.owner, OrgRole.manager];

@ApiTags('catalog')
@ApiBearerAuth('JWT')
@Controller('categories')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @ApiOperation({ summary: 'List categories' })
  findAll() {
    return this.categories.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a category' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.findOne(id);
  }

  @Post()
  @Roles(...CATALOG_EDITORS)
  @ApiOperation({ summary: 'Create a category' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @Roles(...CATALOG_EDITORS)
  @ApiOperation({ summary: 'Update a category' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @Roles(...CATALOG_EDITORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.remove(id);
  }
}

@ApiTags('catalog')
@ApiBearerAuth('JWT')
@Controller('price-tiers')
export class PriceTierController {
  constructor(private readonly tiers: PriceTierService) {}

  @Get()
  @ApiOperation({ summary: 'List price tiers' })
  findAll() {
    return this.tiers.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a price tier' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tiers.findOne(id);
  }

  @Post()
  @Roles(...CATALOG_EDITORS)
  @ApiOperation({ summary: 'Create a price tier' })
  create(@Body() dto: CreatePriceTierDto) {
    return this.tiers.create(dto);
  }

  @Patch(':id')
  @Roles(...CATALOG_EDITORS)
  @ApiOperation({ summary: 'Update a price tier' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceTierDto,
  ) {
    return this.tiers.update(id, dto);
  }

  @Delete(':id')
  @Roles(...CATALOG_EDITORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a price tier' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.tiers.remove(id);
  }
}

@ApiTags('catalog')
@ApiBearerAuth('JWT')
@Controller('products')
export class ProductController {
  constructor(
    private readonly products: ProductService,
    private readonly barcodes: BarcodeService,
  ) {}

  @Get()
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Matches name or SKU',
  })
  @ApiOperation({ summary: 'List products with their units and tier prices' })
  findAll(
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.products.findAll({ categoryId, search });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product, including its derived VAT split' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findOneWithTax(id);
  }

  @Get(':id/price')
  @ApiQuery({ name: 'unitId', required: true })
  @ApiQuery({ name: 'tierId', required: false })
  @ApiOperation({
    summary: 'Resolve the price of one unit for a tier',
    description:
      'Falls back to basePrice x unit factor when the tier has no explicit price for that unit.',
  })
  resolvePrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('unitId', ParseUUIDPipe) unitId: string,
    @Query('tierId') tierId?: string,
  ) {
    return this.products.resolvePrice(id, unitId, tierId);
  }

  @Post()
  @Roles(...CATALOG_EDITORS)
  @ApiOperation({ summary: 'Create a product with its unit hierarchy' })
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Post(':id/prices')
  @Roles(...CATALOG_EDITORS)
  @ApiOperation({ summary: 'Set the price of one unit for one tier' })
  setPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetProductPriceDto,
  ) {
    return this.products.setPrice(id, dto);
  }

  @Patch(':id')
  @Roles(...CATALOG_EDITORS)
  @ApiOperation({ summary: 'Update a product' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @Roles(...CATALOG_EDITORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a product' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.remove(id);
  }

  @Get(':id/barcodes')
  @ApiOperation({ summary: 'List the barcodes on a product' })
  listBarcodes(@Param('id', ParseUUIDPipe) id: string) {
    return this.barcodes.findForProduct(id);
  }

  @Post(':id/barcodes')
  @Roles(...CATALOG_EDITORS)
  @ApiOperation({
    summary: 'Attach a barcode to one unit of a product',
    description:
      'Omit `code` to generate an internal EAN-13 for goods that arrive unbarcoded. GS1 codes are rejected if the check digit does not match.',
  })
  addBarcode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBarcodeDto,
  ) {
    return this.barcodes.create(id, dto);
  }
}

@ApiTags('catalog')
@ApiBearerAuth('JWT')
@Controller()
export class ScanController {
  constructor(
    private readonly scans: ScanService,
    private readonly barcodes: BarcodeService,
  ) {}

  @Get('scan/:code')
  @ApiQuery({ name: 'tierId', required: false })
  @ApiOperation({
    summary: 'Resolve a scanned code to a product, unit and price',
    description:
      'The single entry point for scanning. `baseQuantity` is how many base units one scan represents, so a carton code resolves to its full piece count.',
  })
  resolve(@Param('code') code: string, @Query('tierId') tierId?: string) {
    return this.scans.resolve(code, tierId);
  }

  @Get('scan/:code/identify')
  @ApiOperation({
    summary: 'Report what kind of code this is, without a database lookup',
  })
  identify(@Param('code') code: string) {
    return this.scans.identify(code);
  }

  @Delete('barcodes/:id')
  @Roles(...CATALOG_EDITORS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a barcode' })
  removeBarcode(@Param('id', ParseUUIDPipe) id: string) {
    return this.barcodes.remove(id);
  }
}
