import { Module } from '@nestjs/common';
import {
  CategoryController,
  PriceTierController,
  ProductController,
  ScanController,
} from './catalog.controller';
import { CategoryService } from './category.service';
import { PriceTierService } from './price-tier.service';
import { ProductService } from './product.service';
import { BarcodeService } from './barcode.service';
import { ScanService } from './scan.service';

@Module({
  controllers: [
    CategoryController,
    PriceTierController,
    ProductController,
    ScanController,
  ],
  providers: [
    CategoryService,
    PriceTierService,
    ProductService,
    BarcodeService,
    ScanService,
  ],
  exports: [
    CategoryService,
    PriceTierService,
    ProductService,
    BarcodeService,
    ScanService,
  ],
})
export class CatalogModule {}
