import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StockAdjustmentReason, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { shopMoney } from '../../common/money/shop-money';
import { SupplierBillService } from '../payables/supplier-bill.service';
import { checkVariant, optionLabel } from '../catalog/variants';
import { StockService, type StockWriter } from './stock.service';
import {
  ReceivingService,
  type ResolvedDeliveryFee,
} from './receiving.service';
import { feeHasSomewhereToGo, splitDeliveryFee } from './delivery-fee';
import { CorrectDeliveryDto } from './dto/delivery-correction.dto';
import {
  CorrectionPreviewView,
  GoodsReceiptView,
} from './dto/goods-receipt.response';
import {
  displayUnit,
  planCorrection,
  type LineChange,
} from './delivery-correction';

/**
 * `POST /goods-receipts/:id/corrections` — a recorded delivery put right.
 *
 * Everything moves in one transaction or nothing does: the stock difference
 * on each line's own lot, the lot's figures, the line's figures, the bill, and
 * the correction record holding what the figures were before. The rules are
 * in `delivery-correction.ts`; this is the writing.
 *
 * Two things stay as they were on purpose. **Sales already made keep their
 * cost** — every money figure on a sale is a snapshot (§6). And the movement
 * carries the delivery's own date, so the month's purchases and vendor
 * targets read the corrected figures while `createdAt` still says when the
 * correction was made.
 */
@Injectable()
export class DeliveryCorrectionService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma,
    private readonly stock: StockService,
    private readonly receiving: ReceivingService,
    private readonly bills: SupplierBillService,
  ) {}

  async correct(
    receiptId: string,
    input: CorrectDeliveryDto,
  ): Promise<GoodsReceiptView> {
    await this.apply(receiptId, input, false);
    return this.receiving.findOne(receiptId);
  }

  /**
   * What a correction would do, without doing it: **the real correction, run
   * and rolled back.** Not a second set of rules that could drift — the same
   * transaction meets the same checks, including the 409 when fewer arrived
   * than have already been sold, and the bill that would drop below what has
   * been paid. So the preview cannot promise what the save refuses.
   */
  async preview(
    receiptId: string,
    input: CorrectDeliveryDto,
  ): Promise<CorrectionPreviewView> {
    try {
      await this.apply(receiptId, input, true);
    } catch (error) {
      if (error instanceof RolledBack) return error.preview;
      throw error;
    }
    throw new Error('A preview must roll back.');
  }

  private async apply(
    receiptId: string,
    input: CorrectDeliveryDto,
    dryRun: boolean,
  ): Promise<void> {
    // The fee is checked before the transaction opens: it reads accounts and
    // memberships the transaction does not write, on a pool that may be one
    // connection wide.
    let fee: ResolvedDeliveryFee | null = null;
    if (input.deliveryFee !== undefined) {
      this.receiving.assertMaySettle();
      const found = await this.prisma.goodsReceipt.findFirst({
        where: { id: receiptId },
        select: { recordedByUserId: true },
      });
      if (!found) throw new NotFoundException('Delivery not found');
      fee = await this.receiving.resolveDeliveryFee(
        input.deliveryFee,
        found.recordedByUserId,
      );
    }

    await this.prisma.$transaction(
      async (tx) => {
        const writer = tx as unknown as StockWriter;
        const receipt = await tx.goodsReceipt.findFirst({
          where: { id: receiptId },
          select: {
            id: true,
            locationId: true,
            receivedAt: true,
            deliveryFee: true,
            deliveryFeeMethod: true,
            deliveryFeeBankAccountId: true,
            deliveryFeePaidTo: true,
            deliveryFeePaidByUserId: true,
            lines: {
              select: {
                id: true,
                productId: true,
                variantId: true,
                batchId: true,
                unitFactor: true,
                quantityReceived: true,
                quantityPaidFor: true,
                totalCost: true,
              },
            },
          },
        });
        if (!receipt) throw new NotFoundException('Delivery not found');

        const feeChanged =
          fee !== null &&
          (Object.keys(fee) as (keyof ResolvedDeliveryFee)[]).some(
            (field) => fee[field] !== receipt[field],
          );
        const feeAfter = feeChanged ? fee!.deliveryFee : receipt.deliveryFee;

        const recorded = await this.withCurrentOptions(
          tx,
          receipt.locationId,
          receipt.lines,
        );
        const plan = planCorrection(recorded, input.lines, { feeChanged });
        if (plan.problems.length > 0) {
          throw new BadRequestException(plan.problems.join(' '));
        }

        // The bill follows the value, never below what has gone against it.
        const bill = await tx.supplierBill.findFirst({
          where: { goodsReceiptId: receipt.id, deletedAt: null },
          select: { id: true, amountDue: true },
        });
        let billAmountAfter: number | null = null;
        if (bill && plan.valueDelta !== 0) {
          const current = await this.bills.balanceOf(bill.id, tx);
          billAmountAfter = bill.amountDue + plan.valueDelta;
          const settled = current.paid + current.rebated;
          if (billAmountAfter < settled) {
            const money = await shopMoney(tx);
            throw new ConflictException(
              `The corrected bill would be ${money(billAmountAfter)}, but ${money(settled)} has already been paid or credited against it. Void the payment that was too much first, then correct the delivery.`,
            );
          }
          await tx.supplierBill.update({
            where: { id: bill.id },
            data: { amountDue: billAmountAfter },
          });
        }

        // For the preview: what came out and went in when a line was the
        // wrong product or option.
        const swapped = new Map<string, { removed: string; added: string }>();

        for (const change of plan.changes) {
          if (change.newProductId) {
            swapped.set(
              change.line.id,
              await this.moveToRightProduct(tx, writer, receipt, change, input),
            );
            continue;
          }

          if (change.newOption) {
            swapped.set(
              change.line.id,
              await this.moveToRightOption(tx, writer, receipt, change, input),
            );
          } else if (change.stockDelta < 0) {
            // Stock: the difference, on the line's own lot.
            await this.stock.recordOutbound(
              {
                productId: change.line.productId,
                variantId: change.variantId,
                locationId: receipt.locationId,
                batchId: change.line.batchId,
                quantity: -change.stockDelta,
                type: StockMovementType.adjustment,
                reason: StockAdjustmentReason.receipt_correction,
                note: input.reason,
                occurredAt: receipt.receivedAt,
                referenceType: 'goods_receipt',
                referenceId: receipt.id,
                force: input.force,
                forcedReason: input.forcedReason,
              },
              writer,
            );
          } else if (change.stockDelta > 0) {
            await this.stock.recordInbound(
              {
                productId: change.line.productId,
                variantId: change.variantId,
                locationId: receipt.locationId,
                batchId: change.line.batchId,
                quantity: change.stockDelta,
                type: StockMovementType.adjustment,
                reason: StockAdjustmentReason.receipt_correction,
                note: input.reason,
                occurredAt: receipt.receivedAt,
                referenceType: 'goods_receipt',
                referenceId: receipt.id,
              },
              writer,
            );
          }

          // The lot: its true figures, so value and the cost of later sales
          // are right.
          await tx.stockBatch.update({
            where: { id: change.line.batchId },
            data: {
              quantityReceived: change.received,
              quantityPaidFor: change.paidFor,
              totalCost: change.totalCost,
            },
          });

          // The line: shown in the biggest unit both figures are whole in —
          // 6½ cartons as 91 pieces, 7 cartons as 7 cartons again.
          const units = await tx.productUnit.findMany({
            where: { productId: change.line.productId },
            select: { id: true, name: true, factor: true },
          });
          const unit = displayUnit(change, units);
          await tx.goodsReceiptLine.update({
            where: { id: change.line.id },
            data: {
              variantId: change.variantId,
              quantityReceived: change.received,
              quantityPaidFor: change.paidFor,
              totalCost: change.totalCost,
              unitId: unit.id,
              unitFactor: unit.factor,
              quantityReceivedInUnit: change.received / unit.factor,
              quantityPaidForInUnit: change.paidFor / unit.factor,
            },
          });

          await this.refreshCostPrice(
            tx,
            change.line.productId,
            change.line.id,
          );
        }

        if (feeChanged) {
          await tx.goodsReceipt.update({
            where: { id: receipt.id },
            data: fee!,
          });
        }
        await this.shareTheFee(tx, receipt.id, feeAfter);

        await tx.goodsReceiptCorrection.create({
          data: {
            organizationId: TenantContext.requireOrganizationId(),
            receiptId: receipt.id,
            reason: input.reason.trim(),
            billAmountBefore:
              bill && billAmountAfter !== null ? bill.amountDue : null,
            billAmountAfter,
            ...(feeChanged && {
              deliveryFeeBefore: receipt.deliveryFee,
              deliveryFeeAfter: feeAfter,
            }),
            recordedByUserId: TenantContext.get()?.userId ?? null,
            lines: {
              create: plan.changes.map((change) => ({
                organizationId: TenantContext.requireOrganizationId(),
                receiptLineId: change.line.id,
                receivedBefore: change.line.quantityReceived,
                receivedAfter: change.received,
                paidForBefore: change.line.quantityPaidFor,
                paidForAfter: change.paidFor,
                totalCostBefore: change.line.totalCost,
                totalCostAfter: change.totalCost,
                ...(change.newProductId && {
                  productIdBefore: change.line.productId,
                  productIdAfter: change.newProductId,
                }),
                ...(change.variantId !== change.line.variantId && {
                  variantIdBefore: change.line.variantId,
                  variantIdAfter: change.variantId,
                }),
              })),
            },
          },
        });

        if (dryRun) {
          throw new RolledBack({
            valueDelta: plan.valueDelta,
            billAmountBefore: bill ? bill.amountDue : null,
            billAmountAfter: bill ? (billAmountAfter ?? bill.amountDue) : null,
            deliveryFeeBefore: receipt.deliveryFee,
            deliveryFeeAfter: feeAfter,
            lines: plan.changes.map((change) => {
              const names = swapped.get(change.line.id);
              return {
                lineId: change.line.id,
                stockDelta: change.stockDelta,
                ...(names && {
                  removedProductName: names.removed,
                  removed: change.line.quantityReceived,
                  addedProductName: names.added,
                }),
              };
            }),
          });
        }
      },
      { timeout: 30_000 },
    );
  }

  /**
   * A line entered as the wrong product (2026-10-07): the recorded product's
   * stock comes back out of the line's own lot, the right product's goes in as
   * a lot of its own at the line's cost, dated the delivery's day, and the line
   * names the right product — so purchases and vendor targets count what came.
   * The old lot is left empty, with its movements, rather than deleted: the
   * ledger is only added to.
   *
   * If some of the wrong product has already been sold from that lot, taking
   * it back out is refused like any shortfall (409), and an owner or manager
   * may still record it with a reason.
   */
  private async moveToRightProduct(
    tx: Pick<TenantPrisma, 'stockBatch' | 'product' | 'goodsReceiptLine'>,
    writer: StockWriter,
    receipt: { id: string; locationId: string; receivedAt: Date },
    change: LineChange,
    input: CorrectDeliveryDto,
  ): Promise<{ removed: string; added: string }> {
    const [oldLot, product, wrong] = await Promise.all([
      tx.stockBatch.findFirst({
        where: { id: change.line.batchId },
        select: { supplierId: true, lotCode: true, expiryDate: true },
      }),
      tx.product.findFirst({
        where: { id: change.newProductId!, deletedAt: null },
        select: {
          id: true,
          name: true,
          trackStock: true,
          units: { select: { id: true, name: true, factor: true } },
          variants: { select: { id: true, name: true, isActive: true } },
        },
      }),
      tx.product.findFirst({
        where: { id: change.line.productId },
        select: {
          name: true,
          variants: { select: { id: true, name: true } },
        },
      }),
    ]);
    if (!product) {
      throw new BadRequestException('That product is not in your catalog.');
    }
    if (!product.trackStock) {
      throw new BadRequestException(
        `${product.name} does not keep stock, so it cannot arrive on a delivery.`,
      );
    }
    // New stock for the right product, so never a retired option — checked
    // here because a correction moves as an adjustment, which the engine lets
    // a retired option make.
    const right = checkVariant(
      product.name,
      product.variants,
      change.variantId,
      {
        allowRetired: false,
      },
    );

    // Out: everything this line brought in of the wrong product, from its lot.
    if (change.line.quantityReceived > 0) {
      await this.stock.recordOutbound(
        {
          productId: change.line.productId,
          variantId: change.line.variantId,
          locationId: receipt.locationId,
          batchId: change.line.batchId,
          quantity: change.line.quantityReceived,
          type: StockMovementType.adjustment,
          reason: StockAdjustmentReason.receipt_correction,
          note: input.reason,
          occurredAt: receipt.receivedAt,
          referenceType: 'goods_receipt',
          referenceId: receipt.id,
          force: input.force,
          forcedReason: input.forcedReason,
        },
        writer,
      );
    }
    await tx.stockBatch.update({
      where: { id: change.line.batchId },
      data: { quantityReceived: 0, quantityPaidFor: 0, totalCost: 0 },
    });

    // In: the right product, as its own lot at this line's figures.
    const lot = await tx.stockBatch.create({
      data: {
        organizationId: TenantContext.requireOrganizationId(),
        productId: product.id,
        supplierId: oldLot?.supplierId ?? null,
        lotCode: oldLot?.lotCode ?? null,
        expiryDate: oldLot?.expiryDate ?? null,
        receivedAt: receipt.receivedAt,
        quantityReceived: change.received,
        quantityPaidFor: change.paidFor,
        totalCost: change.totalCost,
      },
      select: { id: true },
    });
    await this.stock.recordInbound(
      {
        productId: product.id,
        variantId: change.variantId,
        locationId: receipt.locationId,
        batchId: lot.id,
        quantity: change.received,
        type: StockMovementType.adjustment,
        reason: StockAdjustmentReason.receipt_correction,
        note: input.reason,
        occurredAt: receipt.receivedAt,
        referenceType: 'goods_receipt',
        referenceId: receipt.id,
      },
      writer,
    );

    const unit = displayUnit(change, product.units);
    await tx.goodsReceiptLine.update({
      where: { id: change.line.id },
      data: {
        productId: product.id,
        variantId: change.variantId,
        batchId: lot.id,
        quantityReceived: change.received,
        quantityPaidFor: change.paidFor,
        totalCost: change.totalCost,
        unitId: unit.id,
        unitFactor: unit.factor,
        quantityReceivedInUnit: change.received / unit.factor,
        quantityPaidForInUnit: change.paidFor / unit.factor,
      },
    });

    await this.refreshCostPrice(tx, product.id, change.line.id);
    // The wrong product's cost display came from this line; it now comes from
    // whichever of its deliveries is latest, if any.
    const latest = await tx.goodsReceiptLine.findFirst({
      where: { productId: change.line.productId, quantityReceived: { gt: 0 } },
      orderBy: [{ receipt: { receivedAt: 'desc' } }, { createdAt: 'desc' }],
      select: { id: true },
    });
    if (latest) {
      await this.refreshCostPrice(tx, change.line.productId, latest.id);
    }

    const wrongOption = wrong?.variants.find(
      (variant) => variant.id === change.line.variantId,
    );
    return {
      removed: wrong
        ? optionLabel(wrong.name, wrongOption?.name)
        : 'the recorded product',
      added: optionLabel(product.name, right?.name),
    };
  }

  /**
   * A line entered as the wrong option of the right product (2026-10-08):
   * Gold's stock comes back out of the line's lot and Moringa's goes into
   * **the same lot**. The option is on the movement, not the lot (§24), so the
   * lot keeps its exact total and nothing is re-costed — the move that adding
   * a product's first options makes. The caller then writes the lot's and the
   * line's true figures, as for any line.
   *
   * Gold already sold from the lot is a shortfall like any other: 409, and an
   * owner or manager may record it with a reason.
   */
  private async moveToRightOption(
    tx: Pick<TenantPrisma, 'product'>,
    writer: StockWriter,
    receipt: { id: string; locationId: string; receivedAt: Date },
    change: LineChange,
    input: CorrectDeliveryDto,
  ): Promise<{ removed: string; added: string }> {
    const product = await tx.product.findFirst({
      where: { id: change.line.productId },
      select: {
        name: true,
        variants: { select: { id: true, name: true, isActive: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    // New stock for the option, so never a retired one (see above).
    const right = checkVariant(
      product.name,
      product.variants,
      change.variantId,
      {
        allowRetired: false,
      },
    );
    const wrong = product.variants.find(
      (variant) => variant.id === change.line.variantId,
    );
    const movement = {
      productId: change.line.productId,
      locationId: receipt.locationId,
      batchId: change.line.batchId,
      type: StockMovementType.adjustment,
      reason: StockAdjustmentReason.receipt_correction,
      note: input.reason,
      occurredAt: receipt.receivedAt,
      referenceType: 'goods_receipt',
      referenceId: receipt.id,
    };

    if (change.line.quantityReceived > 0) {
      await this.stock.recordOutbound(
        {
          ...movement,
          variantId: change.line.variantId,
          quantity: change.line.quantityReceived,
          force: input.force,
          forcedReason: input.forcedReason,
        },
        writer,
      );
    }
    await this.stock.recordInbound(
      { ...movement, variantId: change.variantId, quantity: change.received },
      writer,
    );

    return {
      removed: optionLabel(product.name, wrong?.name),
      added: optionLabel(product.name, right?.name),
    };
  }

  /**
   * The lines with the option their stock is in now. A line recorded before
   * its product had options names none, but the stock it brought was moved
   * into one when they were added — a `transfer_in` naming that option on
   * the line's own lot (`StockService.moveIntoVariant`). That option is what
   * the line is corrected from: naming it is no change, naming another is a
   * swap, and a count difference lands where the stock actually is.
   */
  private async withCurrentOptions<
    L extends { batchId: string; variantId: string | null },
  >(
    tx: Pick<TenantPrisma, 'stockMovement'>,
    locationId: string,
    lines: readonly L[],
  ): Promise<L[]> {
    const legacy = lines.filter((line) => line.variantId === null);
    if (legacy.length === 0) return [...lines];
    const moved = await tx.stockMovement.findMany({
      where: {
        batchId: { in: legacy.map((line) => line.batchId) },
        locationId,
        type: StockMovementType.transfer_in,
        variantId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      select: { batchId: true, variantId: true },
    });
    const into = new Map<string, string>();
    for (const row of moved) {
      if (row.variantId && !into.has(row.batchId)) {
        into.set(row.batchId, row.variantId);
      }
    }
    return lines.map((line) =>
      line.variantId === null && into.has(line.batchId)
        ? { ...line, variantId: into.get(line.batchId)! }
        : line,
    );
  }

  /**
   * The delivery fee, split again by the lines' values as they now stand, and
   * each lot's total put to its line's value plus its share (2026-10-09).
   *
   * Run after every correction, not only one to the fee: a line whose value
   * changed takes a different share, and so does every other line. Lots whose
   * total is already right are left alone. Sales already made keep their
   * cost, as with every correction.
   */
  private async shareTheFee(
    tx: Pick<TenantPrisma, 'goodsReceiptLine' | 'stockBatch' | 'product'>,
    receiptId: string,
    fee: number,
  ) {
    const lines = await tx.goodsReceiptLine.findMany({
      where: { receiptId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        productId: true,
        batchId: true,
        totalCost: true,
        deliveryCost: true,
        quantityReceived: true,
        batch: { select: { totalCost: true } },
      },
    });
    if (fee > 0 && !feeHasSomewhereToGo(lines)) {
      throw new BadRequestException(
        'Nothing on this delivery arrived, so a delivery fee has nothing to be part of the cost of. Take the fee off too.',
      );
    }

    const shares = splitDeliveryFee(fee, lines);
    for (const [index, line] of lines.entries()) {
      const deliveryCost = shares[index];
      const lotTotal = line.totalCost + deliveryCost;
      if (deliveryCost !== line.deliveryCost) {
        await tx.goodsReceiptLine.update({
          where: { id: line.id },
          data: { deliveryCost },
        });
      }
      if (lotTotal !== line.batch.totalCost) {
        await tx.stockBatch.update({
          where: { id: line.batchId },
          data: { totalCost: lotTotal },
        });
      }
      if (deliveryCost !== line.deliveryCost) {
        await this.refreshCostPrice(tx, line.productId, line.id);
      }
    }
  }

  /**
   * The cost-price display, as a delivery writes it — but only when this line
   * is still the product's latest delivery, or a correction to an old delivery
   * would overwrite what a newer one set. A display only; never a valuation
   * input (§2).
   */
  private async refreshCostPrice(
    tx: Pick<TenantPrisma, 'goodsReceiptLine' | 'product'>,
    productId: string,
    lineId: string,
  ) {
    const latest = await tx.goodsReceiptLine.findFirst({
      where: { productId },
      orderBy: [{ receipt: { receivedAt: 'desc' } }, { createdAt: 'desc' }],
      select: {
        id: true,
        totalCost: true,
        deliveryCost: true,
        quantityReceived: true,
      },
    });
    if (latest?.id !== lineId || latest.quantityReceived === 0) return;
    await tx.product.update({
      where: { id: productId },
      data: {
        costPrice: Math.round(
          (latest.totalCost + latest.deliveryCost) / latest.quantityReceived,
        ),
      },
    });
  }
}

/** Carries a preview out of a transaction it has just rolled back. */
class RolledBack extends Error {
  constructor(readonly preview: CorrectionPreviewView) {
    super('Preview rolled back');
  }
}
