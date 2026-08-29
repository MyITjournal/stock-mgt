import { Module } from '@nestjs/common';
import {
  CategoryController,
  PackagingTypeController,
  PriceTierController,
  ProductController,
  ScanController,
} from './catalog.controller';
import { CategoryService } from './category.service';
import { PackagingTypeService } from './packaging-type.service';
import { PriceTierService } from './price-tier.service';
import { ProductService } from './product.service';
import { BarcodeService } from './barcode.service';
import { ScanService } from './scan.service';

@Module({
  controllers: [
    CategoryController,
    PackagingTypeController,
    PriceTierController,
    ProductController,
    ScanController,
  ],
  providers: [
    CategoryService,
    PackagingTypeService,
    PriceTierService,
    ProductService,
    BarcodeService,
    ScanService,
  ],
  exports: [
    CategoryService,
    PackagingTypeService,
    PriceTierService,
    ProductService,
    BarcodeService,
    ScanService,
  ],
})
export class CatalogModule {}
