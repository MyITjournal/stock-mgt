import { Injectable } from '@nestjs/common';
import { Prisma, User as PrismaUser } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { User } from '../entities/user.entity';

/**
 * What a user record may contain when it leaves this class.
 *
 * An explicit allow-list, not an exclusion, and that choice is load-bearing.
 * `User` carries `@Exclude()` on its secrets, which does nothing: it needs
 * `ClassSerializerInterceptor`, which was never registered, and the rows here
 * are plain Prisma objects rather than class instances anyway. The protection
 * read as present in the code and was not — `GET /users/:id` returned argon2
 * password hashes to any authenticated caller, from any organization.
 *
 * A `select` fails closed. A new column is invisible until somebody adds it
 * here on purpose, which is the opposite of how the old arrangement failed.
 */
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  bio: true,
  photoUrl: true,
  role: true,
  authProvider: true,
  isVerified: true,
  onboardingComplete: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Exported so a test can assert that no secret ever joins the list. */
export const PUBLIC_USER_SELECT_KEYS: string[] =
  Object.keys(PUBLIC_USER_SELECT);

/** What login needs and nothing else may ask for. */
export interface UserCredentials {
  id: string;
  email: string;
  password: string | null;
  isVerified: boolean;
  deletedAt: Date | null;
}

@Injectable()
export class UserModelAction {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(user: Partial<PrismaUser> | null): User | null {
    if (!user) return null;
    const domain = user as unknown as User;
    domain.fullName =
      [domain.firstName, domain.lastName].filter(Boolean).join(' ') || null;
    return domain;
  }

  private whereUnique(
    identifier: Partial<Pick<User, 'id' | 'email'>>,
  ): Prisma.UserWhereUniqueInput {
    if (identifier.id) return { id: identifier.id };
    if (identifier.email) return { email: identifier.email };
    throw new Error('No valid unique identifier provided for user lookup');
  }

  async get(options: {
    identifierOptions: Partial<Pick<User, 'id' | 'email'>>;
  }): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: this.whereUnique(options.identifierOptions),
      // `deletedAt` is selected only so a soft-deleted user can be filtered
      // out below; it is stripped again before the row is returned.
      select: { ...PUBLIC_USER_SELECT, deletedAt: true },
    });
    if (!user || user.deletedAt) return null;

    // `deletedAt` was selected only to make the check above possible, so it is
    // dropped rather than handed to the caller.
    const visible = { ...user };
    delete (visible as { deletedAt?: Date | null }).deletedAt;
    return this.toDomain(visible);
  }

  /**
   * The password hash, for signing in — the one caller that legitimately needs
   * it, named so that any other use stands out in a review.
   */
  async getCredentials(email: string): Promise<UserCredentials | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        isVerified: true,
        deletedAt: true,
      },
    });
    if (!user || user.deletedAt) return null;
    return user;
  }

  async create(options: {
    transactionOptions?: unknown;
    createPayload: Partial<User>;
  }): Promise<User> {
    const created = await this.prisma.user.create({
      data: options.createPayload as Prisma.UserUncheckedCreateInput,
    });
    return this.toDomain(created) as User;
  }

  async update(options: {
    transactionOptions?: unknown;
    identifierOptions: Partial<Pick<User, 'id' | 'email'>>;
    updatePayload: Partial<User>;
  }): Promise<User | null> {
    await this.prisma.user.update({
      where: this.whereUnique(options.identifierOptions),
      data: options.updatePayload as Prisma.UserUncheckedUpdateInput,
    });
    return this.get({ identifierOptions: options.identifierOptions });
  }

  async delete(options: {
    transactionOptions?: unknown;
    identifierOptions: Partial<Pick<User, 'id' | 'email'>>;
  }): Promise<void> {
    await this.prisma.user.update({
      where: this.whereUnique(options.identifierOptions),
      data: { deletedAt: new Date() },
    });
  }

  async list(options: {
    paginationPayload: { page: number; limit: number };
    order?: { createdAt: 'ASC' | 'DESC' };
    /** Restricts the list to members of this organization. */
    organizationId?: string;
  }): Promise<{
    data: User[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { page, limit } = options.paginationPayload;

    // Scoped to one organization's members. `User` cannot join
    // `TENANT_SCOPED_MODELS` — a person may belong to several businesses, so
    // the row itself carries no `organizationId` — which means the filter has
    // to be applied here, deliberately, on every query. Without it this
    // returned every user in the database; it was reachable only by a platform
    // admin, but the next screen to reuse it would not have known that.
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(options.organizationId && {
        memberships: { some: { organizationId: options.organizationId } },
      }),
    };
    const orderBy: Prisma.UserOrderByWithRelationInput | undefined =
      options.order
        ? {
            createdAt:
              options.order.createdAt === 'ASC'
                ? Prisma.SortOrder.asc
                : Prisma.SortOrder.desc,
          }
        : undefined;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        select: PUBLIC_USER_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: data as unknown as User[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  findByEmail(email: string): Promise<User | null> {
    return this.get({ identifierOptions: { email } });
  }
}
