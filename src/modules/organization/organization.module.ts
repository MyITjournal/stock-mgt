import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

/**
 * The business itself, and the letterhead its documents carry.
 *
 * Exported because the documents module needs it: every printed invoice and
 * statement opens with these details.
 */
@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
