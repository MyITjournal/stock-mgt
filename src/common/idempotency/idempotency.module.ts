import { Global, Module } from '@nestjs/common';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@Global()
@Module({
  providers: [IdempotencyInterceptor, IdempotencyCleanupService],
  exports: [IdempotencyInterceptor],
})
export class IdempotencyModule {}
