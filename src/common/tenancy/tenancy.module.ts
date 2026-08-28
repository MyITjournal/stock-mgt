import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TENANT_PRISMA, createTenantPrisma } from './tenant.prisma';

/**
 * Provides the organization-scoped Prisma client. One instance serves every
 * request — the organization is read from AsyncLocalStorage at query time, not
 * bound at construction — so no request-scoped providers are needed.
 */
@Global()
@Module({
  providers: [
    {
      provide: TENANT_PRISMA,
      useFactory: (prisma: PrismaService) => createTenantPrisma(prisma),
      inject: [PrismaService],
    },
  ],
  exports: [TENANT_PRISMA],
})
export class TenancyModule {}
