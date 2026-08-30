import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { DashboardService } from './dashboard.service';

/**
 * Reads, and only reads. Nothing in here writes a row.
 *
 * It depends on `PaymentsModule` for `ReceivableService` rather than
 * recomputing "who owes me" — two implementations of that arithmetic is
 * precisely how a dashboard comes to disagree with the receivables screen it
 * links to.
 */
@Module({
  imports: [PaymentsModule],
  controllers: [ReportController],
  providers: [ReportService, DashboardService],
  exports: [ReportService],
})
export class ReportsModule {}
