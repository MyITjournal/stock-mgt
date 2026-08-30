import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PaymentMethod, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import {
  SYNC_LAG_MS,
  decodeCursor,
  encodeCursor,
  keysetWhere,
} from '../../common/pagination/keyset-cursor';
import { resolveProductUnit } from '../inventory/base-units';
import { LocationService } from '../inventory/location.service';
import { StockService, StockWriter } from '../inventory/stock.service';
import { resolveUnitPrice } from '../catalog/pricing';
import { CreateSaleDto, SaleLineDto } from './dto/create-sale.dto';
import { priceLine, roundCost } from './sale-pricing';
import { withBalance } from '../payments/balance';

/** How many sales one page returns when the caller does not say. */
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;

export interface SaleQuery {
  customerId?: string;
  locationId?: string;
  /** Everything recorded after this point. Ignored when `cursor` is given. */
  since?: Date;
  cursor?: string;
  limit?: number;
}

const SALE_INCLUDE = {
  customer: {
    select: { id: true, firstName: true, lastName: true, phone: true },
  },
  location: { select: { id: true, name: true } },
  tier: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, firstName: true, lastName: true } },
  lines: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
      unit: { select: { id: true, name: true, factor: true } },
    },
  },
  returns: true,
  // A voided payment never settled anything, so it must not appear against the
  // invoice it briefly claimed — otherwise `withBalance` counts money that was
  // never taken. Same rule as `LIVE_ALLOCATIONS`, spelled out here because this
  // selection also carries the payment for display.
  allocations: {
    where: { payment: { voidedAt: null } },
    include: {
      payment: {
        select: { id: true, method: true, reference: true, occurredAt: true },
      },
    },
  },
} as const;

/**
 * Selling.
 *
 * A sale is an invoice with lines, and the only thing that makes it different
 * from a quote is that it moves stock. That movement is *not* written here: it
 * goes through `StockService.recordOutbound`, which is the seam
 * `InventoryModule` exports. FEFO picking, the refusal to sell stock that is
 * not there, and the owner/manager override all come from that one place, so
 * selling cannot drift from the rest of the ledger.
 *
 * Everything money-shaped on a sale is a snapshot. Prices move, tax rates
 * change, and a carton is redefined now and then; none of that may rewrite what
 * a customer paid last week.
 */
@Injectable()
export class SaleService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly stock: StockService,
    private readonly locations: LocationService,
  ) {}

  async create(input: CreateSaleDto) {
    const locationId =
      input.locationId ?? (await this.locations.resolveDefaultId());
    await this.locations.assertExists(locationId);

    const tierId = await this.resolveTierId(input.customerId);
    const saleId = input.id ?? randomUUID();
    const occurredAt = input.occurredAt
      ? new Date(input.occurredAt)
      : new Date();
    const organizationId = TenantContext.requireOrganizationId();
    const recordedByUserId = TenantContext.get()?.userId ?? null;

    await this.prisma.$transaction(async (tx) => {
      const writer = tx as unknown as StockWriter;
      const lines: LineToWrite[] = [];

      for (const line of input.lines) {
        lines.push(
          await this.prepareLine(line, {
            writer,
            saleId,
            locationId,
            tierId,
            occurredAt,
            force: input.force,
            forcedReason: input.forcedReason,
          }),
        );
      }

      const total = sum(lines.map((line) => line.lineTotal));
      const taxTotal = sum(lines.map((line) => line.taxAmount));
      const costTotal = sum(lines.map((line) => line.costOfGoodsSold));

      // Omitted means paid in full in cash — the counter sale, which is the
      // common case. `{ amount: 0 }` is the sale that goes out on credit.
      const paid = input.payment?.amount ?? total;
      if (paid > total) {
        throw new BadRequestException(
          `Payment (${paid}) is more than the sale total (${total}). Record what the sale was worth; change handed back is not part of it.`,
        );
      }
      if (paid < 0) {
        throw new BadRequestException(
          'A sale cannot be recorded with a negative payment. Take goods back through a return instead.',
        );
      }

      await tx.sale.create({
        data: {
          id: saleId,
          organizationId,
          number: await this.nextNumber(tx, organizationId),
          customerId: input.customerId ?? null,
          locationId,
          tierId,
          total,
          taxTotal,
          costTotal,
          note: input.note ?? null,
          occurredAt,
          recordedByUserId,
        },
      });

      await tx.saleLine.createMany({
        data: lines.map((line) => ({ ...line, organizationId, saleId })),
      });

      // Written here rather than left to a second request: a rep at a counter
      // must be able to record one sale in one round trip, which is the whole
      // point of the offline constraints in §8.
      if (paid > 0) {
        const paymentId = randomUUID();
        await tx.payment.create({
          data: {
            id: paymentId,
            organizationId,
            customerId: input.customerId ?? null,
            amount: paid,
            method: input.payment?.method ?? PaymentMethod.cash,
            reference: input.payment?.reference ?? null,
            occurredAt,
            recordedByUserId,
          },
        });
        await tx.paymentAllocation.create({
          data: { organizationId, paymentId, saleId, amount: paid },
        });
      }
    });

    return this.findOne(saleId);
  }

  /**
   * One line: what it is, what it costs the customer, and what it cost us.
   *
   * The stock movement happens here rather than in a second pass, because the
   * batches FEFO picks are what decide the cost of goods sold — and picking
   * line by line is also what makes two lines of the same product draw down the
   * same batches in order.
   */
  private async prepareLine(
    line: SaleLineDto,
    ctx: LineContext,
  ): Promise<LineToWrite> {
    // One read: the unit, whether it is stocked, and the tier prices. Asking
    // the catalog to price it separately would fetch the same product again.
    const { product, unit } = await resolveProductUnit(
      this.prisma,
      line.productId,
      line.unitId,
      { allowUnstocked: true, withPrices: true },
    );

    const unitPrice =
      line.unitPrice ??
      resolveUnitPrice(product, unit, ctx.tierId ?? undefined).price;

    const priced = priceLine(unitPrice, line.quantity, product.taxRateBps);
    const baseQuantity = line.quantity * unit.factor;

    // A service or any other non-stocked item is sold, priced and taxed like
    // everything else; it simply has no stock to take and nothing it cost.
    if (!product.trackStock) {
      return {
        id: line.id,
        productId: product.id,
        unitId: unit.id,
        quantity: line.quantity,
        unitFactor: unit.factor,
        baseQuantity,
        ...priced,
        costOfGoodsSold: 0,
      };
    }

    const movements = await this.stock.recordOutbound(
      {
        productId: product.id,
        locationId: ctx.locationId,
        quantity: baseQuantity,
        type: StockMovementType.sale,
        occurredAt: ctx.occurredAt,
        referenceType: 'sale',
        referenceId: ctx.saleId,
        force: ctx.force,
        forcedReason: ctx.forcedReason,
      },
      ctx.writer,
    );

    return {
      id: line.id,
      productId: product.id,
      unitId: unit.id,
      quantity: line.quantity,
      unitFactor: unit.factor,
      baseQuantity,
      ...priced,
      // Rounded exactly once, here, from the exact fractions of the batches
      // that actually left. Never `costPrice × quantity` — that is the rounded
      // average DECISIONS.md §2 forbids as an input.
      costOfGoodsSold: roundCost(
        await this.stock.costOf(movements, ctx.writer),
      ),
    };
  }

  /**
   * The next invoice number, claimed inside the sale's own transaction.
   *
   * The increment takes a row lock on the organization, which is what
   * guarantees two tills cannot be handed the same number. `nextSaleNumber` is
   * the one to hand out *next*, so the number this sale gets is the value from
   * before the increment.
   */
  private async nextNumber(
    db: Pick<TenantPrisma, 'organization'>,
    organizationId: string,
  ): Promise<string> {
    // Organization is not tenant-scoped — it *is* the tenant — so this must
    // name the id rather than rely on the filter every other model gets.
    const { nextSaleNumber } = await db.organization.update({
      where: { id: organizationId },
      data: { nextSaleNumber: { increment: 1 } },
      select: { nextSaleNumber: true },
    });

    return `INV-${String(nextSaleNumber - 1).padStart(4, '0')}`;
  }

  /**
   * Which price list this sale runs on: the customer's, or the organization's
   * default. A walk-in has no customer and gets the default, which is what the
   * seeded "Retail" tier is for.
   */
  private async resolveTierId(customerId?: string): Promise<string | null> {
    if (customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, deletedAt: null },
        select: { priceTierId: true },
      });
      if (!customer) throw new NotFoundException('Customer not found');
      if (customer.priceTierId) return customer.priceTierId;
    }

    const fallback = await this.prisma.priceTier.findFirst({
      where: { deletedAt: null, isDefault: true },
    });
    return fallback?.id ?? null;
  }

  /**
   * Sales, newest last, paged by keyset so a syncing device can resume exactly
   * where it stopped. Same shape and the same one-second safety lag as the
   * stock ledger's delta sync.
   */
  async findAll(query: SaleQuery = {}) {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE, MAX_PAGE);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const syncedThrough = new Date(Date.now() - SYNC_LAG_MS);

    const rows = await this.prisma.sale.findMany({
      where: {
        ...(query.customerId && { customerId: query.customerId }),
        ...(query.locationId && { locationId: query.locationId }),
        AND: [
          { createdAt: { lte: syncedThrough } },
          ...keysetWhere(cursor, query.since),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: SALE_INCLUDE,
    });

    const last = rows.at(-1);

    return {
      sales: rows.map(withBalance),
      nextCursor:
        rows.length === limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
      syncedThrough,
      hasMore: rows.length === limit,
    };
  }

  async findOne(id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id },
      include: SALE_INCLUDE,
    });
    if (!sale) throw new NotFoundException('Sale not found');
    return withBalance(sale);
  }

  /**
   * A flat payload for printing: what a customer is handed, and nothing else.
   *
   * Separate from `findOne` because a receipt is a *contract with a printer*,
   * not a view of the row — it has to keep saying the same things in the same
   * shape while the sale model underneath keeps growing. Deliberately narrow:
   * no ids beyond the invoice number, no cost of goods sold, no tier name.
   */
  async receipt(id: string) {
    const sale = await this.findOne(id);

    return {
      number: sale.number,
      occurredAt: sale.occurredAt,
      customer: sale.customer
        ? `${sale.customer.firstName} ${sale.customer.lastName ?? ''}`.trim()
        : null,
      servedBy: sale.recordedBy
        ? `${sale.recordedBy.firstName ?? ''} ${sale.recordedBy.lastName ?? ''}`.trim()
        : null,
      lines: sale.lines.map((line) => ({
        description: line.product.name,
        unit: line.unit.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      })),
      total: sale.total,
      tax: sale.taxTotal,
      paid: sale.allocated,
      balance: sale.balance,
      note: sale.note,
    };
  }
}

interface LineContext {
  writer: StockWriter;
  saleId: string;
  locationId: string;
  tierId: string | null;
  occurredAt: Date;
  force?: boolean;
  forcedReason?: string;
}

interface LineToWrite {
  id?: string;
  productId: string;
  unitId: string;
  quantity: number;
  unitFactor: number;
  baseQuantity: number;
  unitPrice: number;
  lineTotal: number;
  taxRateBps: number;
  taxAmount: number;
  costOfGoodsSold: number;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
