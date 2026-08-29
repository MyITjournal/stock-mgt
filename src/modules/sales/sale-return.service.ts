import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { StockService, StockWriter } from '../inventory/stock.service';
import { CreateReturnDto } from './dto/create-return.dto';
import { proportionOfLine } from './sale-pricing';
import { SaleService } from './sale.service';

/**
 * Goods coming back.
 *
 * Two things make a return more than a negative sale. It refunds a share of
 * what was *actually charged* — a line sold at a negotiated price refunds at
 * that price, not the list one — and it puts stock back into the lot it came
 * out of, so a returned carton keeps the expiry date it left with rather than
 * becoming an anonymous unit with none.
 *
 * Goods that come back broken are refunded but not restocked. That is the whole
 * of the "void a sale" story too: a sale rung up by mistake is returned in full,
 * which needs no status machine and leaves the ledger with both movements.
 */
@Injectable()
export class SaleReturnService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly stock: StockService,
    private readonly sales: SaleService,
  ) {}

  async create(saleId: string, input: CreateReturnDto) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId },
      include: { lines: true, returns: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    const returnGroupId = input.id ?? randomUUID();
    const occurredAt = input.occurredAt
      ? new Date(input.occurredAt)
      : new Date();
    const organizationId = TenantContext.requireOrganizationId();
    const recordedByUserId = TenantContext.get()?.userId ?? null;

    // How much of each line has already gone back, so two partial returns
    // cannot together exceed what was sold.
    const alreadyReturned = new Map<string, number>();
    for (const row of sale.returns) {
      alreadyReturned.set(
        row.saleLineId,
        (alreadyReturned.get(row.saleLineId) ?? 0) + row.quantity,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const writer = tx as unknown as StockWriter;

      for (const line of input.lines) {
        const saleLine = sale.lines.find(
          (candidate) => candidate.id === line.saleLineId,
        );
        if (!saleLine) {
          throw new NotFoundException(
            `Line ${line.saleLineId} does not belong to this sale`,
          );
        }

        const unitFactor = await this.factorFor(saleLine.unitId, line.unitId);
        const baseQuantity = line.quantity * unitFactor;
        const outstanding =
          saleLine.baseQuantity - (alreadyReturned.get(saleLine.id) ?? 0);

        if (baseQuantity > outstanding) {
          throw new ConflictException(
            `Cannot return ${baseQuantity} of line ${saleLine.id}: ${outstanding} of the ${saleLine.baseQuantity} sold are still outstanding.`,
          );
        }
        alreadyReturned.set(
          saleLine.id,
          (alreadyReturned.get(saleLine.id) ?? 0) + baseQuantity,
        );

        const restocked = line.restocked ?? true;
        if (restocked) {
          await this.restore(saleLine, baseQuantity, {
            writer,
            saleId,
            locationId: sale.locationId,
            occurredAt,
          });
        }

        await tx.saleReturn.create({
          data: {
            ...(line.id && { id: line.id }),
            organizationId,
            saleId,
            saleLineId: saleLine.id,
            returnGroupId,
            quantity: baseQuantity,
            refundAmount: proportionOfLine(
              saleLine.lineTotal,
              saleLine.baseQuantity,
              baseQuantity,
            ),
            costAmount: proportionOfLine(
              saleLine.costOfGoodsSold,
              saleLine.baseQuantity,
              baseQuantity,
            ),
            restocked,
            reason: line.reason ?? null,
            note: input.note ?? null,
            occurredAt,
            recordedByUserId,
          },
        });
      }
    });

    return this.sales.findOne(saleId);
  }

  /**
   * Puts stock back into the batches the sale took it from.
   *
   * The sale's own movements are the record of which lots left, so they are
   * refilled in reverse — the batch picked last is the one topped up first,
   * which for a FEFO pick means the longest-dated lot goes back first and the
   * short-dated one is only refilled if more comes back than that lot held.
   *
   * If the goods outlast the movements they came from — a line returned after
   * its batches were somehow purged — the remainder lands in the batch the last
   * movement named, rather than being silently dropped.
   */
  private async restore(
    saleLine: { id: string; productId: string; baseQuantity: number },
    baseQuantity: number,
    ctx: {
      writer: StockWriter;
      saleId: string;
      locationId: string;
      occurredAt: Date;
    },
  ) {
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        referenceType: 'sale',
        referenceId: ctx.saleId,
        productId: saleLine.productId,
        type: StockMovementType.sale,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (movements.length === 0) {
      throw new ConflictException(
        'This sale has no stock movements to return the goods into.',
      );
    }

    let remaining = baseQuantity;
    for (const [index, movement] of movements.entries()) {
      if (remaining === 0) break;

      const isLast = index === movements.length - 1;
      const take = isLast
        ? remaining
        : Math.min(Math.abs(movement.quantity), remaining);

      await this.stock.recordInbound(
        {
          productId: saleLine.productId,
          locationId: ctx.locationId,
          batchId: movement.batchId,
          quantity: take,
          type: StockMovementType.return_in,
          occurredAt: ctx.occurredAt,
          referenceType: 'sale_return',
          referenceId: ctx.saleId,
        },
        ctx.writer,
      );
      remaining -= take;
    }
  }

  /**
   * The factor to count the returned quantity in. Defaults to the unit the line
   * was sold in, so "two cartons back" needs no arithmetic from the caller.
   */
  private async factorFor(soldUnitId: string, unitId?: string) {
    const unit = await this.prisma.productUnit.findFirst({
      where: { id: unitId ?? soldUnitId },
      select: { factor: true },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit.factor;
  }
}
