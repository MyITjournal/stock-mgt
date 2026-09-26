import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * What the goods-receipt endpoints return.
 *
 * **These are the service's declared return types, not descriptions of them**
 * (DECISIONS.md §17).
 *
 * A goods receipt *is* the vendor's invoice, so two rules from §2 shape every
 * field below:
 *
 * - **The invoice total is the input, the unit cost is the output.** A line
 *   stores exactly what was charged, in kobo. `unitCost` is
 *   `totalCost / quantityReceived`, computed on read and never stored.
 * - **Free goods are not a special case.** "Buy 19, get 1 free" is received
 *   more than paid for: stock rises by 20, the bill is for 19, and the cost
 *   each falls out of the division on its own.
 *
 * The money is a buying price, so it is **absent rather than zeroed** for a
 * role that may not see cost (§9). The receipt itself stays readable: a
 * storekeeper who recorded a delivery has to be able to check what they
 * entered, and the quantities are the part they entered.
 *
 * **Receipt is goods, bill is money** (§16). Every delivery also raises a
 * `SupplierBill`, which is what appears on `GET /payables`. Nothing here is
 * what the vendor is owed.
 */

class ReceiptSupplierRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Dangote Distribution' })
  name!: string;
}

class ReceiptLocationRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Main Store' })
  name!: string;
}

class ReceiptProductRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Peak Milk 400g' })
  name!: string;

  @ApiProperty({ example: 'PEAK-400' })
  sku!: string;
}

class ReceiptUnitRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Carton' })
  name!: string;

  @ApiProperty({
    example: 12,
    description: 'Base units per unit of this name.',
  })
  factor!: number;
}

class ReceiptRecorderRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;
}

/** The lot a receipt line created. One line, one lot, always. */
class ReceiptBatchView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  supplierId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'LOT-2026-04' })
  lotCode!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiryDate!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  receivedAt!: Date;

  @ApiProperty({ description: 'Base units that arrived.' })
  quantityReceived!: number;

  @ApiProperty({ description: 'Base units the invoice charged for.' })
  quantityPaidFor!: number;

  @ApiPropertyOptional({
    description:
      'The same invoice total as the line carries. **Absent** for a role that may not see cost — redacted with the line rather than left as the way round the front door.',
  })
  totalCost?: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

/** A delivery line as the list shows it. */
export class GoodsReceiptLineSummary {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  receiptId!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  unitId!: string;

  @ApiProperty({ format: 'uuid' })
  batchId!: string;

  @ApiProperty({
    description: 'As entered, in the unit named — cartons, not pieces.',
  })
  quantityReceivedInUnit!: number;

  @ApiProperty({
    description: 'What the invoice charged for, in the same unit.',
  })
  quantityPaidForInUnit!: number;

  @ApiProperty({
    description:
      'The factor applied at write time. A snapshot: redefining what a carton means later cannot rewrite what this delivery put on the shelf.',
  })
  unitFactor!: number;

  @ApiProperty({
    description: 'What arrived, in base units — what the ledger moved.',
  })
  quantityReceived!: number;

  @ApiProperty({ description: 'What was charged for, in base units.' })
  quantityPaidFor!: number;

  @ApiPropertyOptional({
    description:
      'The exact invoice total for this line, in kobo — never a per-unit price. **Absent** for a role that may not see cost.',
  })
  totalCost?: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: () => ReceiptProductRef })
  product!: ReceiptProductRef;
}

/** The same line on the detail screen, with its lot and the rate it implies. */
export class GoodsReceiptLineView extends GoodsReceiptLineSummary {
  @ApiProperty({ type: () => ReceiptUnitRef })
  unit!: ReceiptUnitRef;

  @ApiProperty({ type: () => ReceiptBatchView })
  batch!: ReceiptBatchView;

  @ApiPropertyOptional({
    description:
      'Output, never input. Divided by what *arrived*, not what was paid for, so free goods pull the cost of every unit down — which is the whole point of them. **Absent** for a role that may not see cost.',
  })
  unitCost?: number;
}

/** A delivery, as the list shows it. */
export class GoodsReceiptSummary {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  supplierId!: string;

  @ApiProperty({ format: 'uuid' })
  locationId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'INV-88213',
    description: "The vendor's own number, which is what they quote.",
  })
  invoiceNumber!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'When the delivery arrived, by the recording device. Orders go by phone in this market and are recorded on arrival — there is no purchase order behind this (§6).',
  })
  receivedAt!: Date;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  recordedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => ReceiptSupplierRef })
  supplier!: ReceiptSupplierRef;

  @ApiProperty({ type: () => ReceiptLocationRef })
  location!: ReceiptLocationRef;

  @ApiProperty({ type: () => [GoodsReceiptLineSummary] })
  lines!: GoodsReceiptLineSummary[];
}

/**
 * One delivery in full.
 *
 * `POST /goods-receipts` answers with this too — it ends in `findOne`, so what
 * you get back for recording a delivery is exactly what reading it later
 * returns.
 */
export class GoodsReceiptView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  supplierId!: string;

  @ApiProperty({ format: 'uuid' })
  locationId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'INV-88213' })
  invoiceNumber!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  receivedAt!: Date;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  recordedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => ReceiptSupplierRef })
  supplier!: ReceiptSupplierRef;

  @ApiProperty({ type: () => ReceiptLocationRef })
  location!: ReceiptLocationRef;

  @ApiProperty({ type: () => ReceiptRecorderRef, nullable: true })
  recordedBy!: ReceiptRecorderRef | null;

  @ApiProperty({ type: () => [GoodsReceiptLineView] })
  lines!: GoodsReceiptLineView[];
}
