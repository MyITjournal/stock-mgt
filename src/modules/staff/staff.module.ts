import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

/**
 * The people who work in one business, and the seat cap that bounds them.
 *
 * Separate from `UsersModule`, which is about the platform's users in general —
 * a different question with a different audience. This one is always about
 * *this* organization.
 */
@Module({
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
