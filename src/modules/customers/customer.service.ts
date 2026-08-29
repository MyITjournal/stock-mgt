import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
} from './dto/create-customer.dto';

@Injectable()
export class CustomerService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  async create(input: CreateCustomerDto) {
    if (input.priceTierId) await this.assertTierExists(input.priceTierId);

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
    await this.findOne(id);
    if (input.priceTierId) await this.assertTierExists(input.priceTierId);

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

  private async assertTierExists(priceTierId: string) {
    const tier = await this.prisma.priceTier.findFirst({
      where: { id: priceTierId, deletedAt: null },
    });
    if (!tier) throw new NotFoundException('Price tier not found');
  }

  findAll() {
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
