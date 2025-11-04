import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Product } from "./product.entity";
import { ProductResolver } from "./product.resolver";
import { ProductService } from "./product.service";

@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  providers: [ProductResolver, ProductService],
  exports: [ProductService],
})
export class ProductModule {}
