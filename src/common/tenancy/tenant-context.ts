import { AsyncLocalStorage } from 'node:async_hooks';
import { OrgRole } from '@prisma/client';

/**
 * Mutable on purpose. The middleware creates the store before anyone is
 * authenticated and the guard fills it in afterwards — see the note below.
 */
export interface TenantStore {
  userId?: string;
  organizationId?: string;
  orgRole?: OrgRole;
}

/**
 * Carries the caller's organization across the async call stack so the Prisma
 * extension in `tenant.prisma.ts` can scope queries without every service
 * threading an organizationId through its signatures.
 *
 * The store is established by TenantContextMiddleware, which wraps the whole
 * request in `run()`, and populated by JwtAuthGuard once the request is
 * authenticated.
 *
 * It is deliberately NOT established with `enterWith()` inside the guard.
 * `enterWith` binds only the current async branch, and Passport invokes the
 * guard's callback on a branch the route handler does not always descend from,
 * so the store went missing on some requests and not others. Wrapping the
 * request in `run()` and mutating the store is the version that always holds.
 */
const storage = new AsyncLocalStorage<TenantStore>();

export const TenantContext = {
  /** Runs `fn` with `store` visible to everything it awaits. */
  run<T>(store: TenantStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  /** Fills in the store the middleware created, once the caller is known. */
  set(values: Required<TenantStore>): void {
    const store = storage.getStore();
    if (!store) return;

    store.userId = values.userId;
    store.organizationId = values.organizationId;
    store.orgRole = values.orgRole;
  },

  /** The current store, or undefined outside a request (cron, bootstrap). */
  get(): TenantStore | undefined {
    return storage.getStore();
  },

  /** The current organization, or undefined when unauthenticated. */
  organizationId(): string | undefined {
    return storage.getStore()?.organizationId;
  },

  /**
   * The current organization, or a throw.
   *
   * Services use this to stamp `organizationId` on creates. The Prisma
   * extension would inject it anyway, but Prisma's generated input types still
   * require the field, and passing it explicitly keeps creates type-checked
   * rather than cast. The extension remains the backstop that also covers
   * reads, updates and deletes.
   */
  requireOrganizationId(): string {
    const organizationId = storage.getStore()?.organizationId;
    if (!organizationId) {
      throw new Error(
        'No organization in context. This code path must run inside an authenticated request.',
      );
    }
    return organizationId;
  },
};
