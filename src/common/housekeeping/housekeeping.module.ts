import { Module } from '@nestjs/common';
import { HousekeepingService } from './housekeeping.service';

/**
 * Clearing rows that have stopped meaning anything, while the server is awake
 * — see HousekeepingService for why not only at midnight.
 */
@Module({
  providers: [HousekeepingService],
})
export class HousekeepingModule {}
