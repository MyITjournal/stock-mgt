import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from './tenant-context';

/**
 * Models whose rows belong to exactly one organization. Anything listed here is
 * automatically filtered and stamped; anything not listed is untouched.
 *
 * Adding a model here is the only thing that protects it. A new tenant-owned
 * table that is left off this list is readable by every other tenant.
 *
 * Slices 3-6 add StockMovement, Supplier, PurchaseOrder, Payment and Expense.
 */
export const TENANT_SCOPED_MODELS = new Set<string>([
  'Membership',
  // Auth reaches RefreshToken through the raw client, before any tenant context
  // exists, so this is defence in depth rather than the active protection.
  'RefreshToken',
  'Category',
  'Product',
  'ProductUnit',
  'ProductBarcode',
  'PriceTier',
  'ProductPrice',
  'Customer',
  'Sale',
  // Reached through the raw client by the interceptor, which runs before the
  // route handler; listed so one tenant's key can never match another's.
  'IdempotencyKey',
]);

/** Reads and writes that select rows through a `where` clause. */
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

export type ScopedArgs = {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
};

function withOrg(
  value: Record<string, unknown> | undefined,
  organizationId: string,
): Record<string, unknown> {
  return { ...(value ?? {}), organizationId };
}

/**
 * Rewrites query arguments so they cannot escape one organization.
 *
 * Kept as a pure function so the scoping rules can be unit-tested without a
 * database — the Prisma extension below is only a thin wrapper around it.
 */
export function applyTenantScope(
  operation: string,
  args: ScopedArgs,
  organizationId: string,
): ScopedArgs {
  const next: ScopedArgs = { ...args };

  if (WHERE_OPERATIONS.has(operation)) {
    next.where = withOrg(next.where, organizationId);
  }

  if (operation === 'create') {
    next.data = withOrg(
      next.data as Record<string, unknown> | undefined,
      organizationId,
    );
  }

  if (operation === 'createMany' && Array.isArray(next.data)) {
    next.data = next.data.map((row) => withOrg(row, organizationId));
  }

  if (operation === 'upsert') {
    next.where = withOrg(next.where, organizationId);
    next.create = withOrg(next.create, organizationId);
  }

  return next;
}

/**
 * Wraps PrismaService so tenant-scoped queries carry the caller's organization
 * whether or not the calling service remembered to add it.
 *
 * `findUnique`/`update`/`delete` rely on Prisma's extended-where-unique support,
 * which permits non-unique filters alongside the unique field — so a row from
 * another organization simply does not match, rather than being returned.
 */
export function createTenantPrisma(base: PrismaService) {
  return base.$extends({
    name: 'tenant-scoping',
    query: {
      $allModels: {
        /* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
        $allOperations({ model, operation, args, query }: any) {
          if (typeof model !== 'string' || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const organizationId = TenantContext.organizationId();
          if (!organizationId) {
            throw new ForbiddenException(
              `Query on tenant-scoped model "${model}" attempted without an organization context`,
            );
          }

          return query(
            applyTenantScope(
              operation as string,
              args as ScopedArgs,
              organizationId,
            ),
          );
        },
        /* eslint-enable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
      },
    },
  });
}

export type TenantPrisma = ReturnType<typeof createTenantPrisma>;

/** Injection token — business services inject this, never the raw PrismaService. */
export const TENANT_PRISMA = 'TENANT_PRISMA';
