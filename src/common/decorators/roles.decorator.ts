import { SetMetadata } from '@nestjs/common';
import { OrgRole, UserRole } from '@prisma/client';

export const ROLES_KEY = 'orgRoles';
export const PLATFORM_ROLES_KEY = 'platformRoles';

/** Restricts a route to the given roles *within the caller's organization*. */
export const Roles = (...roles: OrgRole[]) => SetMetadata(ROLES_KEY, roles);

/** Restricts a route to staff of the SaaS platform itself. */
export const PlatformRoles = (...roles: UserRole[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);
