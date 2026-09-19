import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole, PaymentMethod, StockMovementType } from '@prisma/client';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { redactCost, redactCostAll } from '../../common/authz/cost-visibility';
import { LocationService } from './location.service';
import { SupplierService } from './supplier.service';
import { StockService } from './stock.service';
import { BankAccountService } from '../payments/bank-account.service';
import { SupplierPaymentService } from '../payables/supplier-payment.service';
import {
  CreateGoodsReceiptDto,
  GoodsReceiptLineDto,
} from './dto/goods-receipt.dto';
import { resolveProductUnit } from './base-units';

/**
 * Who may say what a delivery costs the business and whether it was paid.
 *
 * The same three who handle money everywhere else. A storekeeper still records
 * the delivery itself, line totals included — they are reading those off the
 * vendor's invoice as they unpack — but what is *owed* and what was *paid* are
 * decisions rather than transcription.
 */
const SETTLES_DELIVERIES: OrgRole[] = [
  OrgRole.owner,
  OrgRole.manager,
  OrgRole.accountant,
];

/** What the vendor charged for a line, as it is stored. */
const RECEIPT_LINE_COST_FIELDS = ['totalCost'] as const;

/** The same, plus the rate `findOne` derives from it on the way out. */
const RECEIPT_LINE_READ_COST_FIELDS = ['totalCost', 'unitCost'] as const;

/** The same invoice total, as it sits on the lot the line created. */
const BATCH_COST_FIELDS = ['totalCost'] as const;

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
    private readonly bankAccounts: BankAccountService,
    private readonly supplierPayments: SupplierPaymentService,
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

    // Recording a delivery is a storekeeper's job, and deciding what the
    // business owes for it is not. The plain path — count what arrived, type
    // the line totals from the invoice — stays open to everyone who could
    // record a receipt before. Overriding the amount due, or saying money
    // changed hands, is a money decision and needs a money role.
    if (input.amountDue !== undefined || input.payment) {
      this.assertMaySettle();
    }

    const lineTotal = lines.reduce(
      (sum, line) => sum + line.input.totalCost,
      0,
    );
    const amountDue = input.amountDue ?? lineTotal;

    if (input.payment && input.payment.amount > amountDue) {
      throw new ConflictException(
        `This delivery is worth ${amountDue} and you are recording a payment of ${input.payment.amount}. Pass amountDue if the vendor's invoice is higher than the goods lines come to.`,
      );
    }

    // Resolved before the transaction opens, because it reads rows the
    // transaction does not write and a rejected account should not have held a
    // write lock while it was being decided. Same rule as money coming in:
    // transfer and pos must name an account, cash must not, never defaulted.
    const paymentAccountId = input.payment
      ? await this.bankAccounts.resolveForPayment(
          input.payment.method ?? PaymentMethod.cash,
          input.payment.bankAccountId,
        )
      : null;

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

      // Every delivery raises a bill, whether or not anybody asked for one.
      //
      // A delivery that arrived and has not been paid for *is* a debt, and the
      // whole point of payables is that the total is trustworthy without
      // somebody having remembered to record it. A receipt that raised no bill
      // would be money owed that never appears on GET /payables.
      //
      // Paid in full on delivery is not an exception to that: the bill opens
      // and the payment closes it in the same transaction, leaving a zero
      // balance that drops off the payables list and stays in the history.
      const bill = await tx.supplierBill.create({
        data: {
          organizationId,
          supplierId: input.supplierId,
          goodsReceiptId: receipt.id,
          invoiceNumber: input.invoiceNumber ?? null,
          amountDue,
          issuedAt: receivedAt,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          recordedByUserId,
        },
      });

      if (input.payment) {
        await this.supplierPayments.recordForDelivery(tx, {
          billId: bill.id,
          supplierId: input.supplierId,
          amount: input.payment.amount,
          method: input.payment.method ?? PaymentMethod.cash,
          bankAccountId: paymentAccountId,
          reference: input.payment.reference,
          occurredAt: receivedAt,
        });
      }

      return receipt.id;
    });

    return this.findOne(receiptId);
  }

  /**
   * Deliveries, newest first.
   *
   * A goods receipt *is* the vendor's invoice — `totalCost` per line is the
   * price the business negotiated — so the money on it follows the same rule as
   * every other buying price and is withheld from a role that may not see cost.
   * The receipt itself stays readable: a storekeeper who recorded a delivery
   * has to be able to check what they entered, and quantities are the part of
   * it they entered.
   */
  async findAll(filter: { supplierId?: string; locationId?: string } = {}) {
    const receipts = await this.prisma.goodsReceipt.findMany({
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

    return receipts.map((receipt) => ({
      ...receipt,
      lines: redactCostAll(receipt.lines, RECEIPT_LINE_COST_FIELDS),
    }));
  }

  async findOne(id: string) {
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, firstName: true, lastName: true } },
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
      lines: receipt.lines.map((line) =>
        redactCost(
          {
            ...line,
            // The lot behind the line carries the same invoice total, so it is
            // redacted with it rather than left as the way round the front door.
            batch: redactCost(line.batch, BATCH_COST_FIELDS),
            /**
             * Output, never input. Divided by what *arrived*, not what was paid
             * for, so free goods pull the cost of every unit down — which is the
             * whole point of them.
             */
            unitCost: line.totalCost / line.quantityReceived,
          },
          RECEIPT_LINE_READ_COST_FIELDS,
        ),
      ),
    };
  }

  /**
   * Turns "20 cartons" into base units, once, at write time.
   *
   * The factor is copied onto the line as `unitFactor`: if someone later edits
   * what a carton means, history must not silently change underneath.
   */
  private assertMaySettle() {
    const orgRole = TenantContext.get()?.orgRole;
    if (!orgRole || !SETTLES_DELIVERIES.includes(orgRole)) {
      throw new ForbiddenException(
        'Only an owner, manager or accountant can set what a delivery costs or record a payment for it. Record the delivery without them and let one of them settle it.',
      );
    }
  }

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
