import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrgRole, PaymentMethod, Prisma } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { shopMoney } from '../../common/money/shop-money';
import {
  SYNC_LAG_MS,
  decodeCursor,
  encodeCursor,
  keysetWhereUpdated,
  keysetWhereUpdatedDesc,
} from '../../common/pagination/keyset-cursor';
import { BankAccountService } from '../payments/bank-account.service';
import { addDays } from '../reports/period';
import { CashFigures, notBanked, oldestUnbanked, stillHolding } from './cash';
import {
  CreateCashBankingDto,
  VoidCashBankingDto,
} from './dto/cash-banking.dto';
import {
  BankingStatus,
  CashBankingListView,
  CashBankingView,
  CashPersonView,
  CashView,
} from './dto/cash.response';

/** Who sees everybody's cash. Everyone else sees their own. */
const SEES_ALL_CASH: OrgRole[] = [
  OrgRole.owner,
  OrgRole.manager,
  OrgRole.accountant,
];

/** Who records banking for somebody else, and confirms or refuses it. */
const CONFIRMS: OrgRole[] = [OrgRole.owner, OrgRole.manager];

const FALLBACK_TIMEZONE = 'Africa/Lagos';
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;
/** How many receipts the oldest-unbanked walk reads per round trip. */
const RECEIPT_PAGE = 200;

const PERSON = { select: { id: true, firstName: true, lastName: true } };

const BANKING_INCLUDE = {
  heldBy: PERSON,
  recordedBy: PERSON,
  confirmedBy: PERSON,
  voidedBy: PERSON,
  bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
} as const;

type BankingRow = Prisma.CashBankingGetPayload<{
  include: typeof BANKING_INCLUDE;
}>;

export interface CashBankingQuery {
  status?: BankingStatus;
  heldByUserId?: string;
  order?: 'asc' | 'desc';
  cursor?: string;
  since?: Date;
  limit?: number;
}

/**
 * Money → Cash: whose hands the shop's cash is in, and the banking that takes
 * it out of them (2026-10-08).
 *
 * Banking is **neither a payment nor an expense**. The money was counted when
 * the customer paid it; a banking row only says it left somebody's hands and
 * where it went, so it touches no invoice, no bill and no profit figure.
 */
@Injectable()
export class CashService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly bankAccounts: BankAccountService,
  ) {}

  /**
   * Each person's figures, and the shop's. Staff get only their own row —
   * always there, at zero, so "My cash" never reads as broken.
   */
  async summary(now = new Date()): Promise<CashView> {
    const me = this.caller();
    const onlyMe = !SEES_ALL_CASH.includes(me.orgRole);
    const { countedFrom, timezone } = await this.settings();

    const figures = await this.figures(
      countedFrom,
      onlyMe ? me.userId : undefined,
    );
    if (onlyMe && !figures.has(me.userId)) figures.set(me.userId, zero());

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...figures.keys()] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const names = new Map(users.map((user) => [user.id, user]));
    const dayAgo = addDays(timezone, now, -1);

    const people: CashPersonView[] = [];
    for (const [userId, row] of figures) {
      const held = stillHolding(row);
      const oldest =
        held > 0
          ? await this.oldestUnbankedFor(userId, held, countedFrom)
          : null;
      people.push({
        userId,
        firstName: names.get(userId)?.firstName ?? null,
        lastName: names.get(userId)?.lastName ?? null,
        ...row,
        stillHolding: held,
        oldestUnbankedAt: oldest,
        overdue: oldest !== null && oldest < dayAgo,
      });
    }
    people.sort((a, b) => b.stillHolding - a.stillHolding);

    const oldestOverall = people
      .map((person) => person.oldestUnbankedAt)
      .filter((at): at is Date => at !== null)
      .reduce<Date | null>((min, at) => (!min || at < min ? at : min), null);

    return {
      countedFrom,
      people,
      totals: {
        received: sum(people, 'received'),
        paidOut: sum(people, 'paidOut'),
        banked: sum(people, 'banked'),
        waiting: sum(people, 'waiting'),
        notBanked: notBanked(people.map((person) => person.stillHolding)),
        oldestUnbankedAt: oldestOverall,
        overdue: people.some((person) => person.overdue),
      },
    };
  }

  async findAll(query: CashBankingQuery = {}): Promise<CashBankingListView> {
    const me = this.caller();
    const limit = Math.min(query.limit ?? DEFAULT_PAGE, MAX_PAGE);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const browsing = query.order === 'desc';
    const syncedThrough = new Date(Date.now() - SYNC_LAG_MS);

    // Staff are pinned to their own rows whatever they ask for.
    const heldByUserId = SEES_ALL_CASH.includes(me.orgRole)
      ? query.heldByUserId
      : me.userId;

    const rows = await this.prisma.cashBanking.findMany({
      where: {
        ...(heldByUserId && { heldByUserId }),
        AND: [
          // A status is a fact about the row, so it is only safe while
          // browsing: a syncing client must hear that a waiting row was
          // confirmed, which a filter on `waiting` would hide.
          ...(browsing && query.status ? [statusWhere(query.status)] : []),
          ...(browsing ? [] : [{ updatedAt: { lte: syncedThrough } }]),
          ...(browsing
            ? keysetWhereUpdatedDesc(cursor)
            : keysetWhereUpdated(cursor, query.since)),
        ],
      },
      orderBy: browsing
        ? [{ updatedAt: 'desc' }, { id: 'desc' }]
        : [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: BANKING_INCLUDE,
    });

    const last = rows.at(-1);
    return {
      bankings: rows.map(toView),
      nextCursor:
        rows.length === limit && last
          ? encodeCursor({ at: last.updatedAt, id: last.id })
          : null,
      syncedThrough,
      hasMore: rows.length === limit,
    };
  }

  async findOne(id: string): Promise<CashBankingView> {
    const me = this.caller();
    const row = await this.prisma.cashBanking.findFirst({
      where: {
        id,
        ...(!SEES_ALL_CASH.includes(me.orgRole) && { heldByUserId: me.userId }),
      },
      include: BANKING_INCLUDE,
    });
    if (!row) throw new NotFoundException('Banking not found');
    return toView(row);
  }

  /**
   * Records cash leaving somebody's hands.
   *
   * **Staff record only their own**; an owner or manager records for anyone.
   * A row is confirmed as it is written when the person writing it could have
   * confirmed it — the owner always, a manager for somebody else — because a
   * second click by the same person checks nothing.
   */
  async create(input: CreateCashBankingDto): Promise<CashBankingView> {
    const me = this.caller();
    const heldByUserId = input.heldByUserId ?? me.userId;

    if (heldByUserId !== me.userId && !CONFIRMS.includes(me.orgRole)) {
      throw new ForbiddenException(
        'You can record only your own cash as banked. Ask the owner or a manager to record it for somebody else.',
      );
    }
    if (input.amount <= 0) {
      throw new BadRequestException('Banking nothing records nothing.');
    }
    await this.assertMember(heldByUserId);
    const bankAccountId = await this.resolveDestination(input);

    const { countedFrom } = await this.settings();
    const held = stillHolding(
      (await this.figures(countedFrom, heldByUserId)).get(heldByUserId) ??
        zero(),
    );
    if (input.amount > held) {
      const money = await shopMoney(this.prisma);
      const whose = heldByUserId === me.userId ? 'You hold' : 'They hold';
      throw new ConflictException({
        error: 'MORE_THAN_HELD',
        message: `That is more cash than was taken. ${whose} ${money(Math.max(held, 0))} not yet banked.`,
        stillHolding: held,
      });
    }

    const confirmsOnRecord = this.mayConfirm(me, heldByUserId);
    const now = new Date();
    const id = input.id ?? randomUUID();

    await this.prisma.cashBanking.create({
      data: {
        id,
        organizationId: TenantContext.requireOrganizationId(),
        heldByUserId,
        amount: input.amount,
        bankAccountId,
        reference: input.reference?.trim() || null,
        note: input.note?.trim() || null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : now,
        recordedByUserId: me.userId,
        ...(confirmsOnRecord && {
          confirmedAt: now,
          confirmedByUserId: me.userId,
        }),
      },
    });

    return this.findOne(id);
  }

  /** The owner or a manager saying the money arrived. Never your own. */
  async confirm(id: string): Promise<CashBankingView> {
    const me = this.caller();
    const row = await this.findOne(id);

    if (row.voidedAt) {
      throw new ConflictException({
        error: 'NOT_RECEIVED',
        message:
          'This banking was marked not received, so it cannot be confirmed.',
      });
    }
    if (row.confirmedAt) {
      throw new ConflictException({
        error: 'ALREADY_CONFIRMED',
        message: 'This banking is already confirmed.',
      });
    }
    if (!this.mayConfirm(me, row.heldBy.id)) {
      throw new ForbiddenException(
        'Nobody confirms their own banking. The owner or another manager has to.',
      );
    }

    await this.prisma.cashBanking.update({
      where: { id },
      data: { confirmedAt: new Date(), confirmedByUserId: me.userId },
    });
    return this.findOne(id);
  }

  /**
   * "Not received": the money did not arrive where the row says. The amount
   * goes back to the person's still holding; the row stays, with its reason.
   */
  async voidBanking(
    id: string,
    input: VoidCashBankingDto,
  ): Promise<CashBankingView> {
    const me = this.caller();
    const row = await this.findOne(id);

    if (row.voidedAt) {
      throw new ConflictException({
        error: 'NOT_RECEIVED',
        message: 'This banking is already marked not received.',
      });
    }

    await this.prisma.cashBanking.update({
      where: { id },
      data: {
        voidedAt: new Date(),
        voidedReason: input.reason.trim(),
        voidedByUserId: me.userId,
      },
    });
    return this.findOne(id);
  }

  // -- Figures --------------------------------------------------------------

  /**
   * Received, paid out, banked and waiting per person — four aggregates, each
   * grouped in the database, so the work does not grow with the history.
   *
   * Rows with nobody recorded against them (from before people were recorded)
   * belong to no one and are left out rather than pinned on somebody.
   */
  private async figures(
    countedFrom: Date | null,
    userId?: string,
  ): Promise<Map<string, CashFigures>> {
    const since = countedFrom ? { gte: countedFrom } : undefined;
    const recorded = userId ?? { not: null };

    const [received, refunded, expenses, supplierPayments, bankings] =
      await Promise.all([
        this.prisma.payment.groupBy({
          by: ['recordedByUserId'],
          where: {
            method: PaymentMethod.cash,
            voidedAt: null,
            amount: { gt: 0 },
            recordedByUserId: recorded,
            ...(since && { occurredAt: since }),
          },
          _sum: { amount: true },
        }),
        this.prisma.payment.groupBy({
          by: ['recordedByUserId'],
          where: {
            method: PaymentMethod.cash,
            voidedAt: null,
            amount: { lt: 0 },
            recordedByUserId: recorded,
            ...(since && { occurredAt: since }),
          },
          _sum: { amount: true },
        }),
        this.prisma.expense.groupBy({
          by: ['recordedByUserId'],
          where: {
            method: PaymentMethod.cash,
            deletedAt: null,
            recordedByUserId: recorded,
            ...(since && { occurredAt: since }),
          },
          _sum: { amount: true },
        }),
        this.prisma.supplierPayment.groupBy({
          by: ['recordedByUserId'],
          where: {
            method: PaymentMethod.cash,
            voidedAt: null,
            recordedByUserId: recorded,
            ...(since && { occurredAt: since }),
          },
          _sum: { amount: true },
        }),
        // Not bounded by `countedFrom`: every banking row was written after
        // counting started, even one dated earlier.
        this.prisma.cashBanking.groupBy({
          by: ['heldByUserId', 'confirmedAt'],
          where: {
            voidedAt: null,
            ...(userId && { heldByUserId: userId }),
          },
          _sum: { amount: true },
        }),
      ]);

    const people = new Map<string, CashFigures>();
    const add = (
      id: string | null,
      field: keyof CashFigures,
      amount: number | null,
    ) => {
      if (!id || !amount) return;
      const row = people.get(id) ?? zero();
      row[field] += amount;
      people.set(id, row);
    };

    for (const row of received)
      add(row.recordedByUserId, 'received', row._sum.amount);
    for (const row of refunded)
      add(row.recordedByUserId, 'paidOut', -(row._sum.amount ?? 0));
    for (const row of expenses)
      add(row.recordedByUserId, 'paidOut', row._sum.amount);
    for (const row of supplierPayments)
      add(row.recordedByUserId, 'paidOut', row._sum.amount);
    for (const row of bankings) {
      add(
        row.heldByUserId,
        row.confirmedAt ? 'banked' : 'waiting',
        row._sum.amount,
      );
    }

    return people;
  }

  /** Reads this person's cash takings newest-first, only as far back as `held` reaches. */
  private async oldestUnbankedFor(
    userId: string,
    held: number,
    countedFrom: Date | null,
  ): Promise<Date | null> {
    const receipts: { amount: number; occurredAt: Date }[] = [];
    let covered = 0;

    for (let skip = 0; covered < held; skip += RECEIPT_PAGE) {
      const page = await this.prisma.payment.findMany({
        where: {
          method: PaymentMethod.cash,
          voidedAt: null,
          amount: { gt: 0 },
          recordedByUserId: userId,
          ...(countedFrom && { occurredAt: { gte: countedFrom } }),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { amount: true, occurredAt: true },
        skip,
        take: RECEIPT_PAGE,
      });
      receipts.push(...page);
      covered += page.reduce((total, row) => total + row.amount, 0);
      if (page.length < RECEIPT_PAGE) break;
    }

    return oldestUnbanked(held, receipts);
  }

  // -- Rules ----------------------------------------------------------------

  /** The owner confirms anything; a manager anybody's but their own. */
  private mayConfirm(
    me: { userId: string; orgRole: OrgRole },
    heldByUserId: string,
  ): boolean {
    if (me.orgRole === OrgRole.owner) return true;
    return me.orgRole === OrgRole.manager && heldByUserId !== me.userId;
  }

  private async resolveDestination(
    input: CreateCashBankingDto,
  ): Promise<string | null> {
    if (input.to === 'owner') {
      if (input.bankAccountId) {
        throw new BadRequestException(
          'Cash handed to the owner did not go into an account. Leave bankAccountId off, or say it went to the bank.',
        );
      }
      return null;
    }

    if (!input.bankAccountId) {
      throw new BadRequestException(
        'Say which account the cash was paid into: send bankAccountId.',
      );
    }
    const account = await this.bankAccounts.findOne(input.bankAccountId);
    if (!account.isActive) {
      throw new BadRequestException(
        `"${account.bankName} — ${account.accountNumber}" is marked inactive, so new money should not be recorded against it.`,
      );
    }
    return account.id;
  }

  private async assertMember(userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (!membership)
      throw new NotFoundException('Nobody by that id works here.');
  }

  private async settings() {
    const organization = await this.prisma.organization.findFirst({
      where: { id: TenantContext.requireOrganizationId() },
      select: { cashCountedFrom: true, timezone: true },
    });
    return {
      countedFrom: organization?.cashCountedFrom ?? null,
      timezone: organization?.timezone || FALLBACK_TIMEZONE,
    };
  }

  private caller(): { userId: string; orgRole: OrgRole } {
    const store = TenantContext.get();
    if (!store?.userId || !store.orgRole) {
      throw new ForbiddenException('Sign in to see cash.');
    }
    return { userId: store.userId, orgRole: store.orgRole };
  }
}

function zero(): CashFigures {
  return { received: 0, paidOut: 0, banked: 0, waiting: 0 };
}

function sum(
  people: readonly CashPersonView[],
  field: keyof CashFigures,
): number {
  return people.reduce((total, person) => total + person[field], 0);
}

function statusWhere(status: BankingStatus): Prisma.CashBankingWhereInput {
  if (status === 'not_received') return { voidedAt: { not: null } };
  if (status === 'confirmed')
    return { voidedAt: null, confirmedAt: { not: null } };
  return { voidedAt: null, confirmedAt: null };
}

function toView(row: BankingRow): CashBankingView {
  return {
    id: row.id,
    heldBy: row.heldBy,
    amount: row.amount,
    bankAccount: row.bankAccount,
    reference: row.reference,
    note: row.note,
    occurredAt: row.occurredAt,
    recordedBy: row.recordedBy,
    status: row.voidedAt
      ? 'not_received'
      : row.confirmedAt
        ? 'confirmed'
        : 'waiting',
    confirmedAt: row.confirmedAt,
    confirmedBy: row.confirmedBy,
    voidedAt: row.voidedAt,
    voidedReason: row.voidedReason,
    voidedBy: row.voidedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
