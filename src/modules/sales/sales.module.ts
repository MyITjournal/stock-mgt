import { Module } from '@nestjs/common';
import { SaleController } from './sale.controller';
import { SaleService } from './sale.service';
import { SaleReturnService } from './sale-return.service';
import { InventoryModule } from '../inventory/inventory.module';

/**
 * Selling. Leans on `InventoryModule` for the stock half — a sale never writes
 * to the ledger itself. Pricing needs no module: it is a pure function over
 * the product the sale has already loaded.
 */
@Module({
  imports: [InventoryModule],
  controllers: [SaleController],
  providers: [SaleService, SaleReturnService],
  exports: [SaleService],
})
export class SalesModule {}
