import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { WorkingHoursModule } from './working-hours.module';

/**
 * The people who work in one business, and the seat cap that bounds them.
 *
 * Separate from `UsersModule`, which is about the platform's users in general —
 * a different question with a different audience. This one is always about
 * *this* organization.
 */
@Module({
  // For TokenService: an owner resetting somebody's password has to be able to
  // end the sessions that password was protecting.
  imports: [AuthModule, WorkingHoursModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
