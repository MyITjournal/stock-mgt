import { ApiProperty } from '@nestjs/swagger';

/**
 * What `GET /bank-accounts` and `GET /bank-accounts/:id` return.
 *
 * **This is the service's declared return type, not a description of it**
 * (DECISIONS.md §17).
 *
 * The till reads this to fill the account picker, which appears **only** for
 * `transfer` and `pos`: those two must name the account the money landed in,
 * `cash` must not, and neither is ever defaulted for a caller who did not
 * choose — a wrong account only surfaces at reconciliation, weeks later (§11).
 *
 * Several accounts is normal for a business here and five is not unusual, which
 * is why this is a table rather than a field on the organization.
 */
export class BankAccountView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'GTBank' })
  bankName!: string;

  @ApiProperty({ example: 'Adebayo Stores Limited' })
  accountName!: string;

  @ApiProperty({ example: '0123456789' })
  accountNumber!: string;

  @ApiProperty({ type: String, nullable: true, example: '058' })
  bankCode!: string | null;

  @ApiProperty({
    description: 'Printed first on an invoice or statement (§6).',
  })
  isDefault!: boolean;

  @ApiProperty({
    description:
      'An account with payments against it can never be deleted, only deactivated — the payments still have to reconcile (§11).',
  })
  isActive!: boolean;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}
