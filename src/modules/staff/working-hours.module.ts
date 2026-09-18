import { Module } from '@nestjs/common';
import { WorkingHoursService } from './working-hours.service';

/**
 * The opening-hours check, on its own so two modules can share it.
 *
 * It used to be exported by `StaffModule`, which was fine until `StaffService`
 * needed `TokenService` to revoke a staff member's sessions when their password
 * is reset — `AuthModule` already imported `StaffModule`, so that would have
 * been a module cycle. The hours check has no dependency on either side, so
 * lifting it out is the version with no `forwardRef` in it.
 */
@Module({
  providers: [WorkingHoursService],
  exports: [WorkingHoursService],
})
export class WorkingHoursModule {}
