import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { CustomerView } from './dto/customer.response';
import {
  CreateCustomerDto,
  MergeCustomerDto,
  UpdateCustomerDto,
} from './dto/create-customer.dto';
import { CustomerMergeView } from './dto/customer.response';

/**
 * Who may decide which price list a customer buys on.
 *
 * The same two roles that edit the tiers themselves in `catalog.controller.ts`,
 * and for the same reason: the tier *is* the price. Creating and editing
 * customers stays open to everybody — a rep meeting a new shop on the route has
 * to be able to write them down — but moving one onto the wholesale list is a
 * pricing decision wearing a contact-details hat. Left open, a rep could move a
 * customer to the cheapest tier, sell to them, and move them back, with no
 * override and nothing on the record.
 */
const SETS_CUSTOMER_TIER: OrgRole[] = [OrgRole.owner, OrgRole.manager];

@Injectable()
export class CustomerService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreateCustomerDto): Promise<CustomerView> {
    if (input.priceTierId) {
      this.assertMaySetTier();
      await this.assertTierExists(input.priceTierId);
    }

    return this.prisma.customer.create({
      data: {
        ...(input.id && { id: input.id }),
        organizationId: TenantContext.requireOrganizationId(),
        firstName: input.firstName,
        middleName: input.middleName ?? null,
        lastName: input.lastName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        priceTierId: input.priceTierId ?? null,
      },
    });
  }

  /**
   * Mostly here so a customer can be moved onto another price list — a retail
   * buyer who grows into a wholesale one.
   */
  async update(id: string, input: UpdateCustomerDto): Promise<CustomerView> {
    const existing = await this.findOne(id);

    // Checked against what it currently is, so re-sending the same tier with a
    // phone number change is not treated as a pricing decision.
    if (
      input.priceTierId !== undefined &&
      input.priceTierId !== existing.priceTierId
    ) {
      this.assertMaySetTier();
      if (input.priceTierId) await this.assertTierExists(input.priceTierId);
    }

    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(input.firstName !== undefined && { firstName: input.firstName }),
        ...(input.middleName !== undefined && { middleName: input.middleName }),
        ...(input.lastName !== undefined && { lastName: input.lastName }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.priceTierId !== undefined && {
          priceTierId: input.priceTierId,
        }),
      },
    });
  }

  private assertMaySetTier() {
    const orgRole = TenantContext.get()?.orgRole;
    if (!orgRole || !SETS_CUSTOMER_TIER.includes(orgRole)) {
      throw new ForbiddenException(
        'Only an owner or manager can put a customer on a different price list.',
      );
    }
  }

  private async assertTierExists(priceTierId: string) {
    const tier = await this.prisma.priceTier.findFirst({
      where: { id: priceTierId, deletedAt: null },
    });
    if (!tier) throw new NotFoundException('Price tier not found');
  }

  /**
   * Folding a duplicate into the customer who stays (2026-10-07). The owner
   * found the same shop entered twice, with invoices under each.
   *
   * Every invoice and payment of the duplicate moves to the kept customer, so
   * what they owe, their statement and their credit are one again — balances
   * are worked out from those rows, so nothing else needs moving. A phone,
   * email or surname the kept customer lacks is taken from the duplicate.
   * The duplicate is removed (`deletedAt`) and remembers where it went
   * (`mergedIntoId`); nothing is deleted outright. Owner or manager only, on
   * the route.
   *
   * Sales sync on `createdAt`, so a device that already holds one of the
   * moved invoices keeps the old name on it until it re-reads the sale. There
   * is no such device yet; when the mobile app arrives, a merge must reach it.
   */
  async merge(id: string, input: MergeCustomerDto): Promise<CustomerMergeView> {
    if (id === input.intoCustomerId) {
      throw new BadRequestException(
        'Choose a different customer to merge into.',
      );
    }
    const [duplicate, kept] = await Promise.all([
      this.findOne(id),
      this.findOne(input.intoCustomerId),
    ]);

    return this.prisma.$transaction(async (tx) => {
      const sales = await tx.sale.updateMany({
        where: { customerId: duplicate.id },
        data: { customerId: kept.id },
      });
      const payments = await tx.payment.updateMany({
        where: { customerId: duplicate.id },
        data: { customerId: kept.id },
      });
      const customer = await tx.customer.update({
        where: { id: kept.id },
        data: {
          ...(!kept.lastName &&
            duplicate.lastName && {
              lastName: duplicate.lastName,
            }),
          ...(!kept.middleName &&
            duplicate.middleName && {
              middleName: duplicate.middleName,
            }),
          ...(!kept.phone && duplicate.phone && { phone: duplicate.phone }),
          ...(!kept.email && duplicate.email && { email: duplicate.email }),
        },
      });
      await tx.customer.update({
        where: { id: duplicate.id },
        data: { deletedAt: new Date(), mergedIntoId: kept.id },
      });
      return {
        customer,
        movedSales: sales.count,
        movedPayments: payments.count,
      };
    });
  }

  /**
   * Removing a customer (2026-10-07) — **only one with no invoices and no
   * payments**: added by mistake, never sold to. A customer with history keeps
   * it; if they are a duplicate, merging moves that history to the one kept,
   * and if not, their invoices are what the business is owed. Soft, like
   * every removal here.
   */
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const [sales, payments] = await Promise.all([
      this.prisma.sale.count({ where: { customerId: id } }),
      this.prisma.payment.count({ where: { customerId: id } }),
    ]);
    if (sales + payments > 0) {
      throw new ConflictException(
        `This customer has ${sales} invoice${sales === 1 ? '' : 's'} and ${payments} payment${payments === 1 ? '' : 's'}, so they stay. If they are the same as another customer, use "Same as another customer?" to merge them.`,
      );
    }
    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  findAll(): Promise<CustomerView[]> {
    return this.prisma.customer.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string): Promise<CustomerView> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
}
