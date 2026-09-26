import { ApiProperty } from '@nestjs/swagger';

/**
 * A vendor goods are bought from.
 *
 * **This is the service's declared return type, not a description of it**
 * (DECISIONS.md §17).
 *
 * Deleting one is a soft delete on purpose: receipts, batches and bills keep
 * pointing at the row, so a delivery from a vendor the business has stopped
 * using still says who it came from.
 */
export class SupplierView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'Dangote Distribution' })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Chasing a delivery, like chasing a debt, is a phone call.',
  })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}
