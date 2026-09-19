import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TENANT_PRISMA } from '../../common/tenancy/tenant.prisma';
import type { TenantPrisma } from '../../common/tenancy/tenant.prisma';
import { TenantContext } from '../../common/tenancy/tenant-context';
import {
  CreateSupplierBillDto,
  UpdateSupplierBillDto,
} from './dto/supplier-bill.dto';
import {
  LIVE_SUPPLIER_PAYMENTS,
  billBalance,
  withBillBalance,
} from './balance';

/** What a bill carries when it is read back. */
const BILL_INCLUDE = {
  supplier: { select: { id: true, name: true, phone: true } },
  goodsReceipt: {
    select: { id: true, invoiceNumber: true, receivedAt: true },
  },
  payments: {
    where: { voidedAt: null },
    orderBy: { occurredAt: 'asc' },
    select: {
      id: true,
      amount: true,
      method: true,
      reference: true,
      occurredAt: true,
    },
  },
} as const;

/**
 * What the business owes its vendors.
 *
 * A bill exists for one of two reasons: a delivery was recorded and raised one,
 * or somebody entered what was already owed when they started using the system.
 * The second is why `goodsReceiptId` is nullable, and why this service can
 * create a bill at all — the normal path is `POST /goods-receipts`.
 */
@Injectable()
export class SupplierBillService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  /**
   * Records a debt that already exists, with no effect on stock.
   *
   * The goods behind an opening balance arrived — and very likely sold — before
   * this row was typed. Writing stock movements for them would put inventory
   * that is not on the shelf into the ledger and break the invariant the smoke
   * suite checks. So this writes money and nothing else.
   */
  async create(input: CreateSupplierBillDto) {
    await this.assertSupplierExists(input.supplierId);

    const bill = await this.prisma.supplierBill.create({
      data: {
        ...(input.id && { id: input.id }),
        organizationId: TenantContext.requireOrganizationId(),
        supplierId: input.supplierId,
        amountDue: input.amountDue,
        invoiceNumber: input.invoiceNumber ?? null,
        issuedAt: input.issuedAt ? new Date(input.issuedAt) : new Date(),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        note: input.note ?? null,
        recordedByUserId: TenantContext.get()?.userId ?? null,
      },
      include: BILL_INCLUDE,
    });

    return withBillBalance(bill);
  }

  async findAll(filter: { supplierId?: string; unsettledOnly?: boolean } = {}) {
    const bills = await this.prisma.supplierBill.findMany({
      where: {
        deletedAt: null,
        ...(filter.supplierId && { supplierId: filter.supplierId }),
      },
      orderBy: [{ issuedAt: 'asc' }, { createdAt: 'asc' }],
      include: BILL_INCLUDE,
    });

    const withBalances = bills.map(withBillBalance);

    return filter.unsettledOnly
      ? withBalances.filter((bill) => bill.balance !== 0)
      : withBalances;
  }

  async findOne(id: string) {
    const bill = await this.prisma.supplierBill.findFirst({
      where: { id, deletedAt: null },
      include: BILL_INCLUDE,
    });
    if (!bill) throw new NotFoundException('Supplier bill not found');
    return withBillBalance(bill);
  }

  /**
   * Corrects a bill — most often `amountDue`, once the vendor's invoice turns
   * up carrying a delivery charge no stock line could hold.
   *
   * Refuses to drop `amountDue` below what has already been paid against it.
   * That state is not a smaller debt, it is a vendor owing *this* business
   * money, and there is nothing here that can represent it — so it is a 409
   * naming the figure rather than a negative balance nobody can act on.
   */
  async update(id: string, input: UpdateSupplierBillDto) {
    const existing = await this.findOne(id);

    if (input.amountDue !== undefined && input.amountDue < existing.paid) {
      throw new ConflictException(
        `${existing.paid} has already been paid against this bill, so it cannot be reduced to ${input.amountDue}. Void a payment first if one of them was wrong.`,
      );
    }

    const bill = await this.prisma.supplierBill.update({
      where: { id },
      data: {
        ...(input.amountDue !== undefined && { amountDue: input.amountDue }),
        ...(input.invoiceNumber !== undefined && {
          invoiceNumber: input.invoiceNumber || null,
        }),
        ...(input.issuedAt !== undefined && {
          issuedAt: new Date(input.issuedAt),
        }),
        ...(input.dueDate !== undefined && {
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
        }),
        ...(input.note !== undefined && { note: input.note || null }),
      },
      include: BILL_INCLUDE,
    });

    return withBillBalance(bill);
  }

  /**
   * Soft-deletes a bill that should never have been entered.
   *
   * Refused once money has been paid against it: the payment is a real thing
   * that happened, and removing the debt it answered would leave it pointing at
   * nothing. Void the payments first, which is the honest order of events.
   */
  async remove(id: string) {
    const bill = await this.findOne(id);

    if (bill.payments.length > 0) {
      throw new ConflictException(
        'This bill has payments against it. Void those first — deleting it would leave money paid against a debt that no longer exists.',
      );
    }

    await this.prisma.supplierBill.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { message: 'Bill removed.' };
  }

  /**
   * The balance of one bill, for the payment path to check against.
   *
   * Reads through the same `LIVE_SUPPLIER_PAYMENTS` filter as everything else,
   * which is the point of it existing.
   */
  async balanceOf(id: string, tx: Pick<TenantPrisma, 'supplierBill'>) {
    const bill = await tx.supplierBill.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        supplierId: true,
        amountDue: true,
        payments: LIVE_SUPPLIER_PAYMENTS,
      },
    });
    if (!bill) throw new NotFoundException('Supplier bill not found');

    return { ...bill, ...billBalance(bill) };
  }

  private async assertSupplierExists(supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
  }
}
