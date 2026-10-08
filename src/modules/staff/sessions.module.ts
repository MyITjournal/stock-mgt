import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';

/**
 * Who is signed in, on its own so the staff screen and the dashboard can share
 * it. It needs only the database, so it adds no edge to the module graph that
 * already had to lift `WorkingHoursModule` out to avoid a cycle.
 */
@Module({
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
