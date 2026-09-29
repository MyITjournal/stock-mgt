import { Module } from '@nestjs/common';
import { PaymentController, ReceivableController } from './payment.controller';
import { PaymentService } from './payment.service';
import { ReceivableService } from './receivable.service';
import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from './bank-account.service';

/**
 * Money in, and the "who owes me" view that makes it worth recording.
 *
 * `ReceivableService` is exported because the reports slice needs the same
 * outstanding figures, and a second implementation of that arithmetic is
 * exactly how two screens come to disagree.
 *
 * `BankAccountService` is exported for the same reason: a sale that banks its
 * own payment has to apply the same rule about which methods need an account,
 * or a transfer taken at the counter would slip through unreconcilable.
 */
@Module({
  controllers: [PaymentController, ReceivableController, BankAccountController],
  providers: [PaymentService, ReceivableService, BankAccountService],
  exports: [PaymentService, ReceivableService, BankAccountService],
})
export class PaymentsModule {}
