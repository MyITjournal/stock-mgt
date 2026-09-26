import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, OrgRole, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { TokenService } from '../auth/token.service';
import {
  CreateStaffDto,
  ResetStaffPasswordDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import { StaffMemberView, StaffPasswordResetView } from './dto/staff.response';

const MEMBER_SELECT = {
  id: true,
  role: true,
  status: true,
  opensAt: true,
  closesAt: true,
  workingDays: true,
  ignoresWorkingHours: true,
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
 * The same list as a colleague sees it: who works here and what they do.
 *
 * Reading the list is open to every member on purpose — a rep needs to know who
 * to hand a sale over to — but that purpose is served by names and roles.
 * `MEMBER_SELECT` also carries `username`, which is *half of a credential* in
 * this product: staff sign in with a username because most have no address, and
 * an owner can set their password directly. Handing every cashier the login
 * name of every colleague, the owner included, is the part that had no reason
 * to be there. Contact details and each person's hours go with it.
 *
 * An allow-list rather than an omission, for the reason §9 gives: a column
 * added later is invisible here until somebody puts it in deliberately.
 */
const COLLEAGUE_SELECT = {
  id: true,
  role: true,
  status: true,
  createdAt: true,
  user: { select: { id: true, firstName: true, lastName: true } },
} as const;

/** Who sees the full staff record, contact details and hours included. */
const SEES_FULL_STAFF_RECORD: OrgRole[] = [OrgRole.owner, OrgRole.manager];

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  list(): Promise<StaffMemberView[]> {
    const orgRole = TenantContext.get()?.orgRole;
    const full = Boolean(orgRole && SEES_FULL_STAFF_RECORD.includes(orgRole));

    return this.prisma.membership.findMany({
      where: { organizationId: TenantContext.requireOrganizationId() },
      select: full ? MEMBER_SELECT : COLLEAGUE_SELECT,
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
  async create(input: CreateStaffDto): Promise<StaffMemberView> {
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

    // Qualified by the shop, so two businesses can each have an "amina" and the
    // globally unique column stays globally unique without anybody thinking
    // about it.
    const username = input.username
      ? `${input.username.toLowerCase()}@${organization.slug}`
      : null;
    const email = input.email?.toLowerCase() ?? null;

    await this.assertIdentifiersFree(email, username);

    const password = await argon2.hash(input.password);

    // The seat count is taken *inside* the transaction, and the transaction is
    // serializable. Counted outside, two requests arriving together both read
    // "four of five in use" and both insert, which is how a business ends up
    // with six people on a five-person plan — the cap is the pricing lever, so
    // a race in it is revenue rather than a rounding error.
    return this.prisma.$transaction(
      async (tx) => {
        await this.assertSeatAvailable(
          organizationId,
          organization.maxUsers,
          tx,
        );

        const user = await tx.user.create({
          data: {
            email,
            username,
            password,
            firstName: input.firstName,
            lastName: input.lastName ?? null,
            // The owner is standing next to them. No address to confirm.
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async update(
    userId: string,
    input: UpdateStaffDto,
    actingUserId: string,
  ): Promise<StaffMemberView> {
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

    // Either time may arrive alone, so the pair is compared as it will end up.
    // Caught here as well as by the database CHECK so the message explains the
    // rule rather than naming a constraint.
    const opensAt =
      input.opensAt !== undefined ? input.opensAt : membership.opensAt;
    const closesAt =
      input.closesAt !== undefined ? input.closesAt : membership.closesAt;
    if (opensAt !== null && closesAt !== null && closesAt <= opensAt) {
      throw new BadRequestException(
        'Their closing time must be later than their opening time. Shifts that run past midnight are not supported yet.',
      );
    }

    const updated = await this.prisma.membership.update({
      where: { id: membership.id },
      data: {
        ...(input.role && { role: input.role }),
        ...(input.status && { status: input.status }),
        ...(input.opensAt !== undefined && { opensAt: input.opensAt }),
        ...(input.closesAt !== undefined && { closesAt: input.closesAt }),
        ...(input.workingDays !== undefined && {
          workingDays: input.workingDays,
        }),
        ...(input.ignoresWorkingHours !== undefined && {
          ignoresWorkingHours: input.ignoresWorkingHours,
        }),
      },
      select: MEMBER_SELECT,
    });

    // `JwtStrategy` re-reads the membership on every request, so a suspension
    // already bites on their next tap without this. Revoking as well closes the
    // refresh token that would otherwise sit valid for a week — a suspended
    // person holding a live credential is a state worth not having, even when
    // nothing currently accepts it.
    if (
      input.status === MembershipStatus.suspended &&
      membership.status !== MembershipStatus.suspended
    ) {
      await this.tokens.revokeAllForUser(userId);
    }

    return updated;
  }

  /**
   * Suspension, not deletion.
   *
   * Their name is on sales, payments and stock movements, and a hard delete
   * would orphan all of it. `JwtStrategy` re-reads membership status on every
   * request, so this locks them out on their next tap rather than when their
   * token expires.
   */
  async suspend(
    userId: string,
    actingUserId: string,
  ): Promise<StaffMemberView> {
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
  async resetPassword(
    userId: string,
    input: ResetStaffPasswordDto,
  ): Promise<StaffPasswordResetView> {
    const organizationId = TenantContext.requireOrganizationId();
    await this.findMembership(userId, organizationId);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await argon2.hash(input.password) },
    });

    // The owner doing this believes they have just locked somebody out, and
    // until now they had not: the new password stops the *next* sign-in, while
    // the refresh token issued before it goes on renewing for up to seven days.
    // `AuthService.resetPassword` has always revoked on the self-service path;
    // this is the same rule on the path an owner actually uses, because most
    // staff have no address and can never use the other one.
    await this.tokens.revokeAllForUser(userId);

    return { message: 'Password updated. Tell them the new one.' };
  }

  /**
   * Active members only: a suspended person does not hold a seat.
   *
   * Takes the client to count with, so the caller can hand in a transaction and
   * have the count and the insert decided together.
   */
  private async assertSeatAvailable(
    organizationId: string,
    maxUsers: number,
    db: Pick<PrismaService, 'membership'> = this.prisma,
  ) {
    const active = await db.membership.count({
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
