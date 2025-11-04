import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Sale } from "./sale.entity";
import { SaleResolver } from "./sale.resolver";
import { SaleService } from "./sale.service";
import { Product } from "../product/product.entity";
import { Customer } from "../customer/customer.entity";

@Module({
  imports: [TypeOrmModule.forFeature([Sale, Product, Customer])],
  providers: [SaleResolver, SaleService],
})
export class SalesModule {}
