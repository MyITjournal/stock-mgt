import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContext } from './tenant-context';

/**
 * Opens an empty tenant store for the lifetime of each request.
 *
 * Middleware runs before guards, so nothing is known about the caller yet. The
 * point is to establish the AsyncLocalStorage scope around the *whole* request
 * with `run()`; JwtAuthGuard then fills the store in once it has authenticated.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    TenantContext.run({}, () => next());
  }
}
