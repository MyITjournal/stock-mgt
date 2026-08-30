import { Module } from '@nestjs/common';
import { PaymentController, ReceivableController } from './payment.controller';
import { PaymentService } from './payment.service';
import { ReceivableService } from './receivable.service';

/**
 * Money in, and the "who owes me" view that makes it worth recording.
 *
 * `ReceivableService` is exported because the reports slice needs the same
 * outstanding figures, and a second implementation of that arithmetic is
 * exactly how two screens come to disagree.
 */
@Module({
  controllers: [PaymentController, ReceivableController],
  providers: [PaymentService, ReceivableService],
  exports: [PaymentService, ReceivableService],
})
export class PaymentsModule {}
