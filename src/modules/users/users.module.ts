import { Module } from '@nestjs/common';
import { UserModelAction } from './actions/user.action';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ResetPasswordModelAction } from './actions/reset-password.action';
import { StaleUsersCleanupService } from './stale-users-cleanup.service';

@Module({
  controllers: [UsersController],
  providers: [
    UserModelAction,
    ResetPasswordModelAction,
    UsersService,
    StaleUsersCleanupService,
  ],
  exports: [UsersService, UserModelAction, ResetPasswordModelAction],
})
export class UsersModule {}
