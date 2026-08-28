import { AsyncLocalStorage } from 'node:async_hooks';
import { OrgRole } from '@prisma/client';

export interface TenantStore {
  userId: string;
  organizationId: string;
  orgRole: OrgRole;
}

/**
 * Carries the caller's organization across the async call stack so the Prisma
 * extension in `tenant.prisma.ts` can scope queries without every service
 * having to thread an organizationId through its signatures.
 *
 * Populated by JwtAuthGuard once per request.
 */
const storage = new AsyncLocalStorage<TenantStore>();

export const TenantContext = {
  /** Runs `fn` with `store` visible to everything it awaits. */
  run<T>(store: TenantStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  /**
   * Binds `store` to the current async context and everything it goes on to
   * await. Used by JwtAuthGuard, which cannot wrap the downstream handler in
   * `run()`. Each HTTP request already has its own async context, so this does
   * not bleed between requests.
   */
  enter(store: TenantStore): void {
    storage.enterWith(store);
  },

  /** The current store, or undefined outside a request (cron, bootstrap). */
  get(): TenantStore | undefined {
    return storage.getStore();
  },

  /** The current organization, or undefined when unauthenticated. */
  organizationId(): string | undefined {
    return storage.getStore()?.organizationId;
  },
};
