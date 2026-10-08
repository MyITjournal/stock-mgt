import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';

/**
 * Money → Cash. Exported so the home screen's "Cash not yet banked" is the
 * same figure the Cash screen shows when somebody clicks into it.
 */
@Module({
  imports: [PaymentsModule],
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
