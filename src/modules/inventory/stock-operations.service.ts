import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  StockAdjustmentReason,
  StockMovement,
  StockMovementType,
} from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { randomUUID } from 'node:crypto';
import { LocationService } from './location.service';
import { StockService } from './stock.service';
import { resolveProductUnit } from './base-units';
import {
  CreateAdjustmentDto,
  CreateTransferDto,
} from './dto/stock-operations.dto';

/**
 * The two stock movements a person performs directly: writing stock off (or on)
 * with a reason, and moving it between locations.
 *
 * Sits above `StockService`, which owns the ledger mechanics, because both of
 * these need the catalog and the location list — the low-level service
 * deliberately knows about neither.
 */
@Injectable()
export class StockOperationsService {
  private readonly logger = new Logger(StockOperationsService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly locations: LocationService,
    private readonly stock: StockService,
  ) {}

  /**
   * A counted correction, breakage, spoilage, theft, or an opening balance.
   *
   * A positive adjustment has to land in a batch, because every movement does.
   * Unless one is named it opens a new one, which is how stock that was never
   * received through a delivery — the pile that was already there on day one —
   * gets into the ledger with a cost attached.
   */
  async adjust(input: CreateAdjustmentDto) {
    const locationId =
      input.locationId ?? (await this.locations.resolveDefaultId());
    await this.locations.assertExists(locationId);

    const { unit } = await resolveProductUnit(
      this.prisma,
      input.productId,
      input.unitId,
    );
    const baseQuantity = input.quantity * unit.factor;
    const occurredAt = input.occurredAt
      ? new Date(input.occurredAt)
      : new Date();

    if (baseQuantity < 0) {
      return this.stock.transaction((tx) =>
        this.stock.recordOutbound(
          {
            id: input.id,
            productId: input.productId,
            locationId,
            batchId: input.batchId,
            quantity: Math.abs(baseQuantity),
            type:
              input.reason === StockAdjustmentReason.damage
                ? StockMovementType.damage
                : StockMovementType.adjustment,
            reason: input.reason,
            note: input.note,
            occurredAt,
            force: input.force,
            forcedReason: input.forcedReason,
          },
          tx,
        ),
      );
    }

    if (input.totalCost === undefined && !input.batchId) {
      // Not an error — stock found in a corner genuinely has no invoice — but
      // it is worth nothing until someone says otherwise, and margins computed
      // from it will read high.
      this.warnUnvaluedStock(input);
    }

    const organizationId = TenantContext.requireOrganizationId();

    return this.prisma.$transaction(async (tx) => {
      const batchId =
        input.batchId ??
        (
          await tx.stockBatch.create({
            data: {
              organizationId,
              productId: input.productId,
              lotCode: input.lotCode ?? null,
              expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
              receivedAt: occurredAt,
              quantityReceived: baseQuantity,
              // Nothing was bought, so nothing was paid for. The cost, if any,
              // is what the owner says this stock is worth.
              quantityPaidFor: 0,
              totalCost: input.totalCost ?? 0,
            },
          })
        ).id;

      const movement = await this.stock.recordInbound(
        {
          id: input.id,
          productId: input.productId,
          locationId,
          batchId,
          quantity: baseQuantity,
          type: StockMovementType.adjustment,
          reason: input.reason,
          note: input.note,
          occurredAt,
        },
        tx,
      );

      return [movement];
    });
  }

  /**
   * Moves stock between two locations without changing what the business owns.
   *
   * Written as a pair of movements sharing a `transferGroupId` rather than one
   * row with two location columns: a balance is then still a plain sum over one
   * location column, and the two halves read as one act on a report.
   *
   * Batch identity is preserved across the move — the carton that arrives in
   * the van is the same lot, with the same expiry, that left the store.
   */
  async transfer(input: CreateTransferDto) {
    if (input.fromLocationId === input.toLocationId) {
      throw new BadRequestException(
        'Source and destination locations must differ.',
      );
    }
    await this.locations.assertExists(input.fromLocationId);
    await this.locations.assertExists(input.toLocationId);

    const { unit } = await resolveProductUnit(
      this.prisma,
      input.productId,
      input.unitId,
    );
    const baseQuantity = input.quantity * unit.factor;
    const occurredAt = input.occurredAt
      ? new Date(input.occurredAt)
      : new Date();
    const transferGroupId = input.id ?? randomUUID();

    return this.stock.transaction(async (tx) => {
      const out = await this.stock.recordOutbound(
        {
          productId: input.productId,
          locationId: input.fromLocationId,
          quantity: baseQuantity,
          type: StockMovementType.transfer_out,
          note: input.note,
          occurredAt,
          transferGroupId,
          force: input.force,
          forcedReason: input.forcedReason,
        },
        tx,
      );

      const inbound: StockMovement[] = [];
      for (const movement of out) {
        inbound.push(
          await this.stock.recordInbound(
            {
              productId: input.productId,
              locationId: input.toLocationId,
              batchId: movement.batchId,
              quantity: Math.abs(movement.quantity),
              type: StockMovementType.transfer_in,
              note: input.note,
              occurredAt,
              transferGroupId,
            },
            tx,
          ),
        );
      }

      return { transferGroupId, out, in: inbound };
    });
  }

  private warnUnvaluedStock(input: CreateAdjustmentDto) {
    if (input.reason !== StockAdjustmentReason.opening_balance) return;
    // Logged rather than rejected: an opening balance is often entered before
    // anyone has dug out what the stock cost.
    this.logger.warn(
      `Opening balance for product ${input.productId} recorded with no cost. Stock valuation will read it as worth nothing.`,
    );
  }
}
