import { ApiProperty } from '@nestjs/swagger';

/**
 * What `GET /cash` and the `/cash/bankings` routes return.
 *
 * **These are the services' declared return types, not descriptions of them**
 * (DECISIONS.md §17).
 */

class PersonRef {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;
}

class BankedInto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'GTBank' })
  bankName!: string;

  @ApiProperty({ example: '0123456789' })
  accountNumber!: string;
}

export const BANKING_STATUSES = [
  'waiting',
  'confirmed',
  'not_received',
] as const;
export type BankingStatus = (typeof BANKING_STATUSES)[number];

export class CashBankingView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: () => PersonRef, description: 'Whose cash it was.' })
  heldBy!: PersonRef;

  @ApiProperty({ description: 'In minor units. Always positive.' })
  amount!: number;

  @ApiProperty({
    type: () => BankedInto,
    nullable: true,
    description: 'Null when it was handed to the owner.',
  })
  bankAccount!: BankedInto | null;

  @ApiProperty({ type: String, nullable: true })
  reference!: string | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: Date;

  @ApiProperty({ type: () => PersonRef, nullable: true })
  recordedBy!: PersonRef | null;

  @ApiProperty({ enum: BANKING_STATUSES })
  status!: BankingStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  confirmedAt!: Date | null;

  @ApiProperty({ type: () => PersonRef, nullable: true })
  confirmedBy!: PersonRef | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  voidedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  voidedReason!: string | null;

  @ApiProperty({ type: () => PersonRef, nullable: true })
  voidedBy!: PersonRef | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class CashBankingListView {
  @ApiProperty({ type: () => [CashBankingView] })
  bankings!: CashBankingView[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  syncedThrough!: Date;

  @ApiProperty()
  hasMore!: boolean;
}

export class CashPersonView {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiProperty({
    description: 'Cash payments they took, voided ones left out.',
  })
  received!: number;

  @ApiProperty({
    description:
      'Cash refunds, cash expenses and cash supplier payments they recorded, and delivery fees paid from their cash.',
  })
  paidOut!: number;

  @ApiProperty({ description: 'Banking an owner or manager has confirmed.' })
  banked!: number;

  @ApiProperty({ description: 'Banking recorded and not yet confirmed.' })
  waiting!: number;

  @ApiProperty({
    description:
      'received − paidOut − banked − waiting. Negative when they paid out more cash than they took.',
  })
  stillHolding!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the oldest cash they still hold was taken.',
  })
  oldestUnbankedAt!: Date | null;

  @ApiProperty({
    description: 'Some of what they hold is more than a day old.',
  })
  overdue!: boolean;
}

export class CashTotalsView {
  @ApiProperty()
  received!: number;

  @ApiProperty()
  paidOut!: number;

  @ApiProperty()
  banked!: number;

  @ApiProperty()
  waiting!: number;

  @ApiProperty({
    description:
      'What people hold, added up. A negative holding never cancels a colleague’s.',
  })
  notBanked!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  oldestUnbankedAt!: Date | null;

  @ApiProperty()
  overdue!: boolean;
}

export class CashView {
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Where counting starts. Null means from the shop’s first payment.',
  })
  countedFrom!: Date | null;

  @ApiProperty({
    type: () => [CashPersonView],
    description:
      'Everybody with cash to account for, most held first. Staff see only themselves.',
  })
  people!: CashPersonView[];

  @ApiProperty({ type: () => CashTotalsView })
  totals!: CashTotalsView;
}
