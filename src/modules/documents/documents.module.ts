import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { OrganizationModule } from '../organization/organization.module';
import { SalesModule } from '../sales/sales.module';
import { PaymentsModule } from '../payments/payments.module';

/**
 * Printable documents.
 *
 * It owns no data and recomputes nothing: it imports the services that already
 * answer these questions, so a PDF and the screen it was printed from cannot
 * disagree.
 */
@Module({
  imports: [OrganizationModule, SalesModule, PaymentsModule],
  controllers: [DocumentController],
  providers: [DocumentService],
})
export class DocumentsModule {}
