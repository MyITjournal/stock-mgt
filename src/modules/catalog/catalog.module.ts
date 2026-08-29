import { Module } from '@nestjs/common';
import {
  CategoryController,
  PriceTierController,
  ProductController,
} from './catalog.controller';
import { CategoryService } from './category.service';
import { PriceTierService } from './price-tier.service';
import { ProductService } from './product.service';

@Module({
  controllers: [CategoryController, PriceTierController, ProductController],
  providers: [CategoryService, PriceTierService, ProductService],
  exports: [CategoryService, PriceTierService, ProductService],
})
export class CatalogModule {}
