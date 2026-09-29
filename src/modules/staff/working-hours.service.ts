import { ForbiddenException, Injectable } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { isWithinWorkingHours, resolveHours } from './working-hours';

/** Exactly what the check needs, so either caller can hand it over. */
export interface MembershipHours {
  role: OrgRole;
  ignoresWorkingHours: boolean;
  opensAt: number | null;
  closesAt: number | null;
  workingDays: number[];
  organization: {
    timezone: string;
    opensAt: number;
    closesAt: number;
    workingDays: number[];
  };
}

/**
 * Refuses a session that starts outside the business's opening hours.
 *
 * **Checked when a session is issued or renewed, never on an ordinary request.**
 * That is the whole design. Access tokens last fifteen minutes, so somebody is
 * locked out within a quarter of an hour of closing — and never in the middle of
 * recording a sale. A half-written sale is a worse problem than the one this
 * solves, and a rule that interrupts work is a rule people route around.
 *
 * Called by both `AuthService.issueForUser` and `TokenService.rotate` rather
 * than living in one of them, because a rule enforced on login but not on
 * renewal would let somebody sign in at five to seven and work all night.
 */
@Injectable()
export class WorkingHoursService {
  assertWithinHours(membership: MembershipHours, now = new Date()): void {
    // The owner is never locked out of their own business. They will look at
    // the day's figures at ten at night, and that is their affair.
    if (membership.role === OrgRole.owner) return;
    if (membership.ignoresWorkingHours) return;

    const hours = resolveHours({
      organization: membership.organization,
      membership,
    });

    const verdict = isWithinWorkingHours(
      now,
      membership.organization.timezone,
      hours,
    );

    if (!verdict.allowed) {
      throw new ForbiddenException({
        error: 'OUTSIDE_WORKING_HOURS',
        message: verdict.reason,
      });
    }
  }
}

/** What both callers must include on their membership query. */
export const HOURS_INCLUDE = {
  organization: {
    select: {
      timezone: true,
      opensAt: true,
      closesAt: true,
      workingDays: true,
    },
  },
} as const;
