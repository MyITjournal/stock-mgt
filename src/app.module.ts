import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { TenancyModule } from './common/tenancy/tenancy.module';
import { TenantContextMiddleware } from './common/tenancy/tenant-context.middleware';
import { MailModule } from './modules/mail/mail.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { OrgRolesGuard } from './modules/auth/guards/org-roles.guard';
import { CustomerModule } from './modules/customers/customer.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { SalesModule } from './modules/orders/sales.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    // Required by StaleUsersCleanupService's @Cron decorator.
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    TenancyModule,
    MailModule,
    AuthModule,
    UsersModule,
    CustomerModule,
    CatalogModule,
    SalesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order matters: authenticate, then check the role, then rate-limit.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: OrgRolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Must wrap every route, including public ones: the store has to exist
    // before JwtAuthGuard can fill it in.
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
