import { ApiProperty } from '@nestjs/swagger';

class RebateSupplierRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

class RebateBillRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  invoiceNumber!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  issuedAt!: Date;
}

/** A vendor's rebate for a month: expected, or credited on a bill. */
export class VendorRebateView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: RebateSupplierRef })
  supplier!: RebateSupplierRef;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'First instant of the month it was earned, in the organization’s timezone.',
  })
  periodStart!: Date;

  @ApiProperty({ description: 'What was expected, in kobo.' })
  expectedAmount!: number;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({
    enum: ['expected', 'credited'],
    description: '`credited` once it has landed on a bill.',
  })
  status!: 'expected' | 'credited';

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'What was actually credited, in kobo.',
  })
  creditedAmount!: number | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'The day it counts in profit: the date of the bill it was credited on.',
  })
  creditedAt!: Date | null;

  @ApiProperty({ type: RebateBillRef, nullable: true })
  bill!: RebateBillRef | null;
}
