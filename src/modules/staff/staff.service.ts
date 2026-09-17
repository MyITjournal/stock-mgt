import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, OrgRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/tenancy/tenant-context';
import {
  CreateStaffDto,
  ResetStaffPasswordDto,
  UpdateStaffDto,
} from './dto/staff.dto';

const MEMBER_SELECT = {
  id: true,
  role: true,
  status: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      username: true,
      isVerified: true,
    },
  },
} as const;

/**
 * The people who work in one business.
 *
 * Reached through the raw client rather than the tenant-scoped one, because
 * `User` cannot be tenant-scoped — a person may work for two businesses, so the
 * row carries no `organizationId`. Every query here pins the organization from
 * the request context by hand instead.
 */
@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.membership.findMany({
      where: { organizationId: TenantContext.requireOrganizationId() },
      select: MEMBER_SELECT,
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Creates the account and the membership together.
   *
   * **Pre-verified, and nothing is emailed.** Registration normally sends a
   * six-digit code, which is useless to a cashier whose address the owner
   * invented — they would never receive it and could never sign in. The owner
   * vouching for them in person *is* the verification.
   */
  async create(input: CreateStaffDto) {
    const organizationId = TenantContext.requireOrganizationId();

    if (!input.username && !input.email) {
      throw new BadRequestException(
        'Give this person a username or an email — they need something to sign in with.',
      );
    }

    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { slug: true, maxUsers: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    await this.assertSeatAvailable(organizationId, organization.maxUsers);

    // Qualified by the shop, so two businesses can each have an "amina" and the
    // globally unique column stays globally unique without anybody thinking
    // about it.
    const username = input.username
      ? `${input.username.toLowerCase()}@${organization.slug}`
      : null;
    const email = input.email?.toLowerCase() ?? null;

    await this.assertIdentifiersFree(email, username);

    const password = await argon2.hash(input.password);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          username,
          password,
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          // The owner is standing next to them. There is no address to confirm.
          isVerified: true,
        },
      });

      return tx.membership.create({
        data: {
          userId: user.id,
          organizationId,
          role: input.role,
          status: MembershipStatus.active,
        },
        select: MEMBER_SELECT,
      });
    });
  }

  async update(userId: string, input: UpdateStaffDto, actingUserId: string) {
    const organizationId = TenantContext.requireOrganizationId();
    const membership = await this.findMembership(userId, organizationId);

    // An owner demoting themselves by accident locks the business out of its
    // own staff screen, so it is refused rather than confirmed.
    if (
      userId === actingUserId &&
      input.role &&
      input.role !== membership.role
    ) {
      throw new BadRequestException(
        'You cannot change your own role. Ask another owner to do it.',
      );
    }
    if (
      userId === actingUserId &&
      input.status === MembershipStatus.suspended
    ) {
      throw new BadRequestException('You cannot suspend yourself.');
    }

    const losingOwner =
      membership.role === OrgRole.owner &&
      ((input.role && input.role !== OrgRole.owner) ||
        input.status === MembershipStatus.suspended);
    if (losingOwner) await this.assertNotLastOwner(organizationId, userId);

    // A seat is only consumed by an active member, so bringing somebody back
    // has to check there is room — suspending somebody else may have freed it.
    if (
      input.status === MembershipStatus.active &&
      membership.status !== MembershipStatus.active
    ) {
      const organization = await this.prisma.organization.findFirstOrThrow({
        where: { id: organizationId },
        select: { maxUsers: true },
      });
      await this.assertSeatAvailable(organizationId, organization.maxUsers);
    }

    return this.prisma.membership.update({
      where: { id: membership.id },
      data: {
        ...(input.role && { role: input.role }),
        ...(input.status && { status: input.status }),
      },
      select: MEMBER_SELECT,
    });
  }

  /**
   * Suspension, not deletion.
   *
   * Their name is on sales, payments and stock movements, and a hard delete
   * would orphan all of it. `JwtStrategy` re-reads membership status on every
   * request, so this locks them out on their next tap rather than when their
   * token expires.
   */
  async suspend(userId: string, actingUserId: string) {
    return this.update(
      userId,
      { status: MembershipStatus.suspended },
      actingUserId,
    );
  }

  /**
   * The owner sets a new password for a member.
   *
   * Not a convenience. Most staff have no address, so the self-service reset
   * flow can never reach them — without this, the first forgotten password
   * would be unrecoverable.
   */
  async resetPassword(userId: string, input: ResetStaffPasswordDto) {
    const organizationId = TenantContext.requireOrganizationId();
    await this.findMembership(userId, organizationId);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await argon2.hash(input.password) },
    });

    return { message: 'Password updated. Tell them the new one.' };
  }

  /** Active members only: a suspended person does not hold a seat. */
  private async assertSeatAvailable(organizationId: string, maxUsers: number) {
    const active = await this.prisma.membership.count({
      where: { organizationId, status: MembershipStatus.active },
    });

    if (active >= maxUsers) {
      throw new ConflictException(
        `This plan covers ${maxUsers} active people and ${active} are already using it. Suspend someone who has left, or move up a plan.`,
      );
    }
  }

  private async assertIdentifiersFree(
    email: string | null,
    username: string | null,
  ) {
    // Refused rather than attached to the existing account. Somebody who
    // already has a login may work for another business, and quietly adding
    // them to a second one is both a consent problem and a way to test whether
    // an address exists. Proper multi-shop staff need an invite they accept.
    const clash = await this.prisma.user.findFirst({
      where: {
        OR: [
          ...(email ? [{ email }] : []),
          ...(username ? [{ username }] : []),
        ],
      },
      select: { email: true, username: true },
    });

    if (clash) {
      throw new ConflictException(
        clash.username === username && username
          ? `The username "${username.split('@')[0]}" is already taken in this shop.`
          : 'An account already exists with that email.',
      );
    }
  }

  private async assertNotLastOwner(organizationId: string, userId: string) {
    const otherOwners = await this.prisma.membership.count({
      where: {
        organizationId,
        role: OrgRole.owner,
        status: MembershipStatus.active,
        userId: { not: userId },
      },
    });

    if (otherOwners === 0) {
      throw new BadRequestException(
        'This is the only owner. Make somebody else an owner first, or the business would have nobody who can manage staff.',
      );
    }
  }

  private async findMembership(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, organizationId },
    });
    // A 404 rather than a 403: whether a given user id exists elsewhere is not
    // this organization's business.
    if (!membership) throw new NotFoundException('Staff member not found');
    return membership;
  }
}
