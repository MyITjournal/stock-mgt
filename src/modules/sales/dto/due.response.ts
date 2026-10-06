import { ApiProperty } from '@nestjs/swagger';

class DueCustomerRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
}

/** One invoice on credit that is due soon or overdue. */
export class DueInvoiceView {
  @ApiProperty({ format: 'uuid' })
  saleId!: string;

  @ApiProperty({ example: 'INV-0042' })
  number!: string;

  @ApiProperty({ type: () => DueCustomerRef })
  customer!: DueCustomerRef;

  @ApiProperty({ description: 'What is still owed, in kobo.' })
  balance!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  dueDate!: Date;

  @ApiProperty({
    description:
      'Whole days past the due day in the shop’s timezone: positive once overdue, 0 on the day, negative while days are left.',
  })
  daysPastDue!: number;
}

/**
 * Payments due: credit sales overdue, due today, or due in the next two days,
 * oldest first. Open to every member of staff — it is who to ask for money,
 * not what anything cost.
 */
export class DueInvoicesView {
  @ApiProperty({ type: () => [DueInvoiceView] })
  invoices!: DueInvoiceView[];

  @ApiProperty({ description: 'How many are past their due day.' })
  overdue!: number;
}
