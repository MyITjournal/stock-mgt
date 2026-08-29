import { Module } from '@nestjs/common';
import { SaleController } from './sale.controller';
import { SaleService } from './sale.service';
import { SaleReturnService } from './sale-return.service';
import { InventoryModule } from '../inventory/inventory.module';
import { CatalogModule } from '../catalog/catalog.module';

/**
 * Selling. Leans on `InventoryModule` for the stock half — a sale never writes
 * to the ledger itself — and on `CatalogModule` for what a thing costs.
 */
@Module({
  imports: [InventoryModule, CatalogModule],
  controllers: [SaleController],
  providers: [SaleService, SaleReturnService],
  exports: [SaleService],
})
export class SalesModule {}
