import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { TenantContext } from '../../../common/tenancy/tenant-context';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

/**
 * Registered globally via APP_GUARD, so every route is authenticated unless it
 * carries @Public(). Defaulting to closed means a new controller cannot be
 * accidentally shipped without protection.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    return super.canActivate(context);
  }

  /**
   * Passport calls this once the strategy has validated. Binding the tenant
   * store here means every query made downstream is automatically scoped to the
   * caller's organization.
   */
  handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    const result: TUser = super.handleRequest<TUser>(
      err,
      user,
      info,
      context,
      status,
    );
    const authenticated = result as AuthenticatedUser | undefined;

    if (authenticated?.organizationId) {
      TenantContext.set({
        userId: authenticated.sub,
        organizationId: authenticated.organizationId,
        orgRole: authenticated.orgRole,
      });
    }

    return result;
  }
}
