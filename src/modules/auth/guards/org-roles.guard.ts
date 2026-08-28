import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole, UserRole } from '@prisma/client';
import {
  PLATFORM_ROLES_KEY,
  ROLES_KEY,
} from '../../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

/** Enforces @Roles (organization role) and @PlatformRoles (SaaS staff role). */
@Injectable()
export class OrgRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const orgRoles = this.reflector.getAllAndOverride<OrgRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const platformRoles = this.reflector.getAllAndOverride<UserRole[]>(
      PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!orgRoles?.length && !platformRoles?.length) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Not authenticated');

    if (platformRoles?.length && platformRoles.includes(user.role)) return true;

    if (orgRoles?.length && orgRoles.includes(user.orgRole)) return true;

    throw new ForbiddenException(
      'Your role does not permit this action in this organization',
    );
  }
}
