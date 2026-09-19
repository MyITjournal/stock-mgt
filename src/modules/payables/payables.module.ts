import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PayablesController } from './payables.controller';
import { PayableService } from './payable.service';
import { SupplierBillService } from './supplier-bill.service';
import { SupplierPaymentService } from './supplier-payment.service';

/**
 * Money owed to vendors, and money paid to them.
 *
 * Separate from `PaymentsModule`, which is money *in* from customers. They share
 * `BankAccountService` — the account a transfer left from is the same set of
 * accounts one lands in — and nothing else. Keeping them apart is what stops a
 * vendor payment ever being counted as revenue, which is the failure mode worth
 * designing against.
 *
 * `SupplierPaymentService` is exported so `ReceivingService` can bank the money
 * handed over at a delivery inside the receipt's own transaction, and
 * `PayableService` so the dashboard can show one total.
 */
@Module({
  imports: [PaymentsModule],
  controllers: [PayablesController],
  providers: [PayableService, SupplierBillService, SupplierPaymentService],
  exports: [PayableService, SupplierBillService, SupplierPaymentService],
})
export class PayablesModule {}
