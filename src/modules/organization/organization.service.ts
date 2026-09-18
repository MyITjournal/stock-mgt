import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { UpdateOrganizationDto } from './dto/organization.dto';

/**
 * The business itself: its name, and the letterhead a printed document carries.
 *
 * Reached through the raw client rather than the tenant-scoped one, because
 * `Organization` *is* the tenant — it carries no `organizationId` of its own to
 * filter on. Every read here pins the id from the request context instead, so
 * one business can still never see another's.
 */
@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  async current() {
    const id = TenantContext.requireOrganizationId();
    const organization = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: ORGANIZATION_FIELDS,
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  async update(input: UpdateOrganizationDto) {
    const id = TenantContext.requireOrganizationId();
    const existing = await this.current();

    // Caught here as well as by the database CHECK, so the message explains the
    // rule instead of naming a constraint. Either time may be sent alone, so
    // the comparison is against what the other one currently is.
    const opensAt = input.opensAt ?? existing.opensAt;
    const closesAt = input.closesAt ?? existing.closesAt;
    if (closesAt <= opensAt) {
      throw new BadRequestException(
        'Closing time must be later than opening time. Shifts that run past midnight are not supported yet.',
      );
    }

    return this.prisma.organization.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.address !== undefined && { address: input.address || null }),
        ...(input.phone !== undefined && { phone: input.phone || null }),
        ...(input.email !== undefined && { email: input.email || null }),
        ...(input.taxId !== undefined && { taxId: input.taxId || null }),
        ...(input.rcNumber !== undefined && {
          rcNumber: input.rcNumber || null,
        }),
        ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl || null }),
        ...(input.opensAt !== undefined && { opensAt: input.opensAt }),
        ...(input.closesAt !== undefined && { closesAt: input.closesAt }),
        ...(input.workingDays !== undefined && {
          workingDays: input.workingDays,
        }),
      },
      select: ORGANIZATION_FIELDS,
    });
  }
}

/**
 * What callers see. `nextSaleNumber` is deliberately absent — it is an internal
 * counter, and exposing it invites somebody to try to set it.
 */
const ORGANIZATION_FIELDS = {
  id: true,
  name: true,
  slug: true,
  currency: true,
  timezone: true,
  address: true,
  phone: true,
  email: true,
  taxId: true,
  rcNumber: true,
  logoUrl: true,
  opensAt: true,
  closesAt: true,
  workingDays: true,
  createdAt: true,
  updatedAt: true,
} as const;
