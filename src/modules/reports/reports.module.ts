import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { DashboardService } from './dashboard.service';
import { PurchaseTargetController } from './purchase-target.controller';
import { PurchaseTargetService } from './purchase-target.service';

/**
 * Reads, and only reads. Nothing in here writes a row.
 *
 * It depends on `PaymentsModule` for `ReceivableService` rather than
 * recomputing "who owes me" — two implementations of that arithmetic is
 * precisely how a dashboard comes to disagree with the receivables screen it
 * links to.
 *
 * Purchase targets are the one exception to reads-only: a target is meaningless
 * apart from the report that measures it, so §15 kept the two together rather
 * than giving the model a module of its own.
 */
@Module({
  imports: [PaymentsModule],
  controllers: [ReportController, PurchaseTargetController],
  providers: [ReportService, DashboardService, PurchaseTargetService],
  exports: [ReportService],
})
export class ReportsModule {}
