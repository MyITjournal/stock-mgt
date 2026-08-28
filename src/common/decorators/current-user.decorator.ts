import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { OrgRole, UserRole } from '@prisma/client';

/**
 * What the auth guard attaches to the request.
 *
 * `role` is the platform role (staff of the SaaS itself); `orgRole` is what the
 * user may do inside the organization they are currently signed into.
 */
export interface AuthenticatedUser {
  sub: string;
  email: string;
  role: UserRole;
  organizationId: string;
  orgRole: OrgRole;
}

type RequestWithUser = Request & { user?: AuthenticatedUser };

export const CurrentUser = createParamDecorator(
  <K extends keyof AuthenticatedUser>(
    field: K | undefined,
    ctx: ExecutionContext,
  ): AuthenticatedUser | AuthenticatedUser[K] | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    return field ? user?.[field] : user;
  },
);
