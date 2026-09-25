import {
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
  UpdateCustomerDto,
} from './dto/create-customer.dto';

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

  async create(input: CreateCustomerDto) {
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
  async update(id: string, input: UpdateCustomerDto) {
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

  findAll(): Promise<CustomerView[]> {
    return this.prisma.customer.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
}
