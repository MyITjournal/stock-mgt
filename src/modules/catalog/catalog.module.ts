import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { InventoryModule } from '../inventory/inventory.module';
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
import { ProductImportService } from './product-import.service';
import { BarcodeService } from './barcode.service';
import { ScanService } from './scan.service';

@Module({
  // Inventory for the stock engine: giving a product that holds stock its
  // first options moves that stock into one of them (§24). Inventory does not
  // import catalog, so there is no cycle.
  imports: [CloudinaryModule, InventoryModule],
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
    ProductImportService,
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
