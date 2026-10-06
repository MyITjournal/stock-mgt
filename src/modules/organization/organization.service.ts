import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { UpdateOrganizationDto } from './dto/organization.dto';
import { OrganizationView } from './dto/organization.response';

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

  async current(): Promise<OrganizationView> {
    const id = TenantContext.requireOrganizationId();
    const [organization, currencyLocked] = await Promise.all([
      this.prisma.organization.findFirst({
        where: { id, deletedAt: null },
        select: ORGANIZATION_FIELDS,
      }),
      this.hasMoneyRecorded(id),
    ]);
    if (!organization) throw new NotFoundException('Organization not found');
    return { ...organization, currencyLocked };
  }

  /**
   * Whether anything with an amount in it exists yet (§2, 2026-10-06).
   *
   * Every amount is stored as a bare integer of the shop's currency, so once
   * one exists, changing the currency would relabel it — ₦50,000 would read
   * £50,000 — and changing the zone would move every report's day boundaries.
   * A price counts as much as a sale: a catalogue imported in naira and then
   * switched to cedis is wrong on every line. Settings is for correcting a
   * choice made at sign-up, before any of that.
   */
  private async hasMoneyRecorded(organizationId: string): Promise<boolean> {
    const where = { organizationId };
    const found = await Promise.all([
      this.prisma.productPrice.findFirst({ where, select: { id: true } }),
      this.prisma.product.findFirst({
        where: { organizationId, basePrice: { not: null } },
        select: { id: true },
      }),
      this.prisma.sale.findFirst({ where, select: { id: true } }),
      this.prisma.stockMovement.findFirst({ where, select: { id: true } }),
      this.prisma.payment.findFirst({ where, select: { id: true } }),
      this.prisma.supplierBill.findFirst({ where, select: { id: true } }),
      this.prisma.expense.findFirst({ where, select: { id: true } }),
    ]);
    return found.some(Boolean);
  }

  async update(input: UpdateOrganizationDto): Promise<OrganizationView> {
    const id = TenantContext.requireOrganizationId();
    const existing = await this.current();

    const movesMoney =
      (input.currency !== undefined && input.currency !== existing.currency) ||
      (input.timezone !== undefined && input.timezone !== existing.timezone);
    if (movesMoney && existing.currencyLocked) {
      throw new ConflictException(
        'The currency and time zone cannot be changed once prices, sales, deliveries, payments or expenses have been recorded — every figure already entered would be relabelled.',
      );
    }

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

    const updated = await this.prisma.organization.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.address !== undefined && {
          address: input.address || null,
        }),
        ...(input.phone !== undefined && { phone: input.phone || null }),
        ...(input.email !== undefined && { email: input.email || null }),
        ...(input.taxId !== undefined && { taxId: input.taxId || null }),
        ...(input.rcNumber !== undefined && {
          rcNumber: input.rcNumber || null,
        }),
        ...(input.logoUrl !== undefined && {
          logoUrl: input.logoUrl || null,
        }),
        ...(input.opensAt !== undefined && { opensAt: input.opensAt }),
        ...(input.closesAt !== undefined && { closesAt: input.closesAt }),
        ...(input.workingDays !== undefined && {
          workingDays: input.workingDays,
        }),
        // Defaults only, so nothing else moves: no price list is added or
        // removed, and products already set up stay as they are.
        ...(input.businessType !== undefined && {
          businessType: input.businessType,
        }),
        // From the next sale on. Sales already made keep their own VAT.
        ...(input.chargesVat !== undefined && {
          chargesVat: input.chargesVat,
        }),
        // Checked above: only while nothing with money in it exists.
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.timezone !== undefined && { timezone: input.timezone }),
      },
      select: ORGANIZATION_FIELDS,
    });
    return { ...updated, currencyLocked: existing.currencyLocked };
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
  maxUsers: true,
  businessType: true,
  chargesVat: true,
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
