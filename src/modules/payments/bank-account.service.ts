import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { BankAccountView } from './dto/bank-account.response';
import {
  CreateBankAccountDto,
  UpdateBankAccountDto,
} from './dto/bank-account.dto';

/**
 * Methods whose money lands in a bank account, and so must name which one.
 *
 * A POS terminal settles into a specific account, so it reconciles the same way
 * a transfer does. A cheque is written today and banked whenever, so it is left
 * optional rather than guessed at.
 */
const BANKED_METHODS: PaymentMethod[] = [
  PaymentMethod.transfer,
  PaymentMethod.pos,
];

@Injectable()
export class BankAccountService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreateBankAccountDto) {
    const accountNumber = normaliseAccountNumber(input.accountNumber);

    try {
      const account = await this.prisma.bankAccount.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId: TenantContext.requireOrganizationId(),
          bankName: input.bankName.trim(),
          accountName: input.accountName.trim(),
          accountNumber,
          bankCode: input.bankCode?.trim() || null,
          isDefault: input.isDefault ?? false,
          isActive: input.isActive ?? true,
          sortOrder: input.sortOrder ?? 0,
          note: input.note ?? null,
        },
      });

      if (account.isDefault) await this.clearOtherDefaults(account.id);
      return account;
    } catch (error) {
      throw translateDuplicate(error, input.bankName, accountNumber);
    }
  }

  findAll(
    options: { includeInactive?: boolean } = {},
  ): Promise<BankAccountView[]> {
    return this.prisma.bankAccount.findMany({
      where: {
        deletedAt: null,
        ...(options.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [
        { isDefault: 'desc' },
        { sortOrder: 'asc' },
        { bankName: 'asc' },
      ],
    });
  }

  async findOne(id: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id, deletedAt: null },
    });
    if (!account) throw new NotFoundException('Bank account not found');
    return account;
  }

  async update(id: string, input: UpdateBankAccountDto) {
    await this.findOne(id);

    const accountNumber =
      input.accountNumber !== undefined
        ? normaliseAccountNumber(input.accountNumber)
        : undefined;

    try {
      const account = await this.prisma.bankAccount.update({
        where: { id },
        data: {
          ...(input.bankName !== undefined && {
            bankName: input.bankName.trim(),
          }),
          ...(input.accountName !== undefined && {
            accountName: input.accountName.trim(),
          }),
          ...(accountNumber !== undefined && { accountNumber }),
          ...(input.bankCode !== undefined && {
            bankCode: input.bankCode?.trim() || null,
          }),
          ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
          ...(input.note !== undefined && { note: input.note }),
        },
      });

      if (account.isDefault) await this.clearOtherDefaults(account.id);
      return account;
    } catch (error) {
      throw translateDuplicate(
        error,
        input.bankName ?? '',
        accountNumber ?? '',
      );
    }
  }

  /**
   * Soft, and refused while payments still point at it.
   *
   * A closed account is usually meant rather than a mistake, and `isActive`
   * already stops it being offered. Removing one that money was banked into
   * would leave those payments unable to say where the money went, which is the
   * one question this model exists to answer.
   */
  async remove(id: string) {
    await this.findOne(id);

    const used = await this.prisma.payment.count({
      where: { bankAccountId: id },
    });
    if (used > 0) {
      throw new ConflictException(
        `${used} payment(s) were banked into this account. Mark it inactive instead, so those payments keep saying where the money went.`,
      );
    }

    await this.prisma.bankAccount.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * Checks a payment names an account when its method needs one, and none when
   * it does not.
   *
   * Returns the id to store. Called by `PaymentService` rather than duplicated
   * there, so a counter sale banking its own payment obeys the same rule as a
   * standalone one.
   */
  async resolveForPayment(
    method: PaymentMethod,
    bankAccountId?: string,
  ): Promise<string | null> {
    if (method === PaymentMethod.cash) {
      if (bankAccountId) {
        throw new BadRequestException(
          'A cash payment did not go into a bank account. Leave bankAccountId off, or record it as a transfer.',
        );
      }
      return null;
    }

    if (!bankAccountId) {
      if (!BANKED_METHODS.includes(method)) return null;

      // Named rather than silently defaulted. Picking the default account for
      // a caller who did not choose would put money in an account it may never
      // have reached, and the mistake only surfaces at reconciliation — by
      // which time nobody remembers which transfer it was.
      const available = await this.findAll();
      throw new BadRequestException(
        available.length === 0
          ? `A ${method} payment has to say which account it landed in. Set your accounts up first with POST /bank-accounts.`
          : `A ${method} payment has to say which account it landed in. Send bankAccountId — you have ${available.length} to choose from.`,
      );
    }

    const account = await this.findOne(bankAccountId);
    if (!account.isActive) {
      throw new BadRequestException(
        `"${account.bankName} — ${account.accountNumber}" is marked inactive, so new money should not be recorded against it.`,
      );
    }
    return account.id;
  }

  /** At most one default, the same rule price tiers and locations follow. */
  private async clearOtherDefaults(keepId: string) {
    await this.prisma.bankAccount.updateMany({
      where: { id: { not: keepId }, isDefault: true },
      data: { isDefault: false },
    });
  }
}

/** Digits only: people paste account numbers with spaces and dashes in them. */
function normaliseAccountNumber(value: string): string {
  return value.replace(/[\s-]/g, '');
}

function translateDuplicate(
  error: unknown,
  bankName: string,
  accountNumber: string,
): Error {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  ) {
    return new ConflictException(
      `${bankName} account ${accountNumber} is already on file.`,
    );
  }
  return error as Error;
}
