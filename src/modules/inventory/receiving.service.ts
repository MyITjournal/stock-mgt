import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { LocationService } from './location.service';
import { SupplierService } from './supplier.service';
import { StockService } from './stock.service';
import {
  CreateGoodsReceiptDto,
  GoodsReceiptLineDto,
} from './dto/goods-receipt.dto';
import { resolveProductUnit } from './base-units';

/** What one line resolved to once the catalog had been consulted. */
interface ResolvedLine {
  input: GoodsReceiptLineDto;
  unitId: string;
  unitFactor: number;
  quantityReceived: number;
  quantityPaidFor: number;
}

/**
 * Goods coming in.
 *
 * Two rules from §2 of the decisions doc shape this whole service:
 *
 * - **The invoice total is the input, the unit cost is the output.** A line
 *   stores what the vendor charged, exactly, in kobo. Unit cost is
 *   `totalCost / quantityReceived`, computed whenever someone asks.
 * - **Free goods are not a special case.** "Buy 19, get 1 free" is simply
 *   received more than paid for: stock rises by 20, the bill is for 19, and the
 *   cost each falls out of the division on its own.
 */
@Injectable()
export class ReceivingService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly locations: LocationService,
    private readonly suppliers: SupplierService,
    private readonly stock: StockService,
  ) {}

  async create(input: CreateGoodsReceiptDto) {
    await this.suppliers.assertExists(input.supplierId);

    const locationId =
      input.locationId ?? (await this.locations.resolveDefaultId());
    await this.locations.assertExists(locationId);

    const lines = await this.resolveLines(input.lines);
    const receivedAt = input.receivedAt
      ? new Date(input.receivedAt)
      : new Date();
    const organizationId = TenantContext.requireOrganizationId();
    const recordedByUserId = TenantContext.get()?.userId ?? null;

    const receiptId = await this.prisma.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.create({
        data: {
          ...(input.id && { id: input.id }),
          organizationId,
          supplierId: input.supplierId,
          locationId,
          invoiceNumber: input.invoiceNumber ?? null,
          receivedAt,
          note: input.note ?? null,
          recordedByUserId,
        },
      });

      for (const line of lines) {
        // One batch per line, never merged with an earlier delivery: each keeps
        // its own exact invoice total, which is what makes unit cost honest.
        const batch = await tx.stockBatch.create({
          data: {
            organizationId,
            productId: line.input.productId,
            supplierId: input.supplierId,
            lotCode: line.input.lotCode ?? null,
            expiryDate: line.input.expiryDate
              ? new Date(line.input.expiryDate)
              : null,
            receivedAt,
            quantityReceived: line.quantityReceived,
            quantityPaidFor: line.quantityPaidFor,
            totalCost: line.input.totalCost,
          },
        });

        await tx.goodsReceiptLine.create({
          data: {
            ...(line.input.id && { id: line.input.id }),
            organizationId,
            receiptId: receipt.id,
            productId: line.input.productId,
            unitId: line.unitId,
            batchId: batch.id,
            quantityReceivedInUnit: line.input.quantityReceived,
            quantityPaidForInUnit:
              line.input.quantityPaidFor ?? line.input.quantityReceived,
            unitFactor: line.unitFactor,
            quantityReceived: line.quantityReceived,
            quantityPaidFor: line.quantityPaidFor,
            totalCost: line.input.totalCost,
          },
        });

        await this.stock.recordInbound(
          {
            productId: line.input.productId,
            locationId,
            batchId: batch.id,
            quantity: line.quantityReceived,
            type: StockMovementType.receipt,
            occurredAt: receivedAt,
            referenceType: 'goods_receipt',
            referenceId: receipt.id,
          },
          tx,
        );

        // A convenience for pricing screens, not a valuation input: costPrice
        // is the most recent unit cost, while `StockBatch.totalCost` stays the
        // exact figure everything financial reads.
        await tx.product.update({
          where: { id: line.input.productId },
          data: {
            costPrice: Math.round(line.input.totalCost / line.quantityReceived),
          },
        });
      }

      return receipt.id;
    });

    return this.findOne(receiptId);
  }

  findAll(filter: { supplierId?: string; locationId?: string } = {}) {
    return this.prisma.goodsReceipt.findMany({
      where: {
        ...(filter.supplierId && { supplierId: filter.supplierId }),
        ...(filter.locationId && { locationId: filter.locationId }),
      },
      orderBy: { receivedAt: 'desc' },
      include: {
        supplier: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        lines: {
          include: { product: { select: { id: true, name: true, sku: true } } },
        },
      },
    });
  }

  async findOne(id: string) {
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            unit: { select: { id: true, name: true, factor: true } },
            batch: true,
          },
        },
      },
    });
    if (!receipt) throw new NotFoundException('Goods receipt not found');

    return {
      ...receipt,
      lines: receipt.lines.map((line) => ({
        ...line,
        /**
         * Output, never input. Divided by what *arrived*, not what was paid
         * for, so free goods pull the cost of every unit down — which is the
         * whole point of them.
         */
        unitCost: line.totalCost / line.quantityReceived,
      })),
    };
  }

  /**
   * Turns "20 cartons" into base units, once, at write time.
   *
   * The factor is copied onto the line as `unitFactor`: if someone later edits
   * what a carton means, history must not silently change underneath.
   */
  private async resolveLines(
    lines: GoodsReceiptLineDto[],
  ): Promise<ResolvedLine[]> {
    const resolved: ResolvedLine[] = [];

    for (const input of lines) {
      const { unit } = await resolveProductUnit(
        this.prisma,
        input.productId,
        input.unitId,
      );

      resolved.push({
        input,
        unitId: unit.id,
        unitFactor: unit.factor,
        quantityReceived: input.quantityReceived * unit.factor,
        quantityPaidFor:
          (input.quantityPaidFor ?? input.quantityReceived) * unit.factor,
      });
    }

    return resolved;
  }
}
