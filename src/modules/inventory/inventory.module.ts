import { Module } from '@nestjs/common';
import {
  GoodsReceiptController,
  LocationController,
  StockController,
  SupplierController,
} from './inventory.controller';
import { LocationService } from './location.service';
import { SupplierService } from './supplier.service';
import { StockService } from './stock.service';
import { StockOperationsService } from './stock-operations.service';
import { StockLevelService } from './stock-level.service';
import { ReceivingService } from './receiving.service';
import { SyncService } from './sync.service';
import { StocktakeService } from './stocktake.service';
import { StocktakeController } from './stocktake.controller';
import { PayablesModule } from '../payables/payables.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  // A delivery raises the bill for it and can bank the money handed over at
  // the door, so receiving reaches into payables. Neither imports back.
  imports: [PayablesModule, PaymentsModule],
  controllers: [
    LocationController,
    SupplierController,
    GoodsReceiptController,
    StockController,
    StocktakeController,
  ],
  providers: [
    LocationService,
    SupplierService,
    StockService,
    StockOperationsService,
    StockLevelService,
    ReceivingService,
    SyncService,
    StocktakeService,
  ],
  // `StockService` is the seam Slice 5 sells through: a sale records an
  // outbound movement rather than touching the ledger itself.
  exports: [
    LocationService,
    SupplierService,
    StockService,
    StockLevelService,
    ReceivingService,
  ],
})
export class InventoryModule {}
