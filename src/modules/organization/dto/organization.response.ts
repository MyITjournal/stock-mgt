import { ApiProperty } from '@nestjs/swagger';

/**
 * The business, and the letterhead a printed document carries.
 *
 * **This is the service's declared return type, not a description of it**
 * (DECISIONS.md §17).
 *
 * **Every letterhead field is nullable on purpose** (§6). A shop that has never
 * opened the profile screen must still be able to invoice today, so the PDF
 * renderer prints what it has rather than refusing. A settings form that
 * treated these as required would be enforcing a rule the product deliberately
 * does not have.
 *
 * `nextSaleNumber` is deliberately **absent**: it is an internal counter, and
 * exposing it invites somebody to try to set it. `currency`, `timezone` and the
 * invoice numbering are readable but **cannot be changed** — periods resolve in
 * the timezone, and rewinding the counter would produce duplicate invoice
 * numbers.
 */
export class OrganizationView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Adebayo Stores' })
  name!: string;

  @ApiProperty({
    example: 'adebayo-stores',
    description:
      'Qualifies staff usernames, so two businesses can each have an Amina.',
  })
  slug!: string;

  @ApiProperty({
    example: 'NGN',
    description:
      'Not editable. Money is stored as an integer count of minor units.',
  })
  currency!: string;

  @ApiProperty({
    example: 'Africa/Lagos',
    description:
      'Not editable. Every report period resolves in this zone, so changing it would restate history.',
  })
  timezone!: string;

  @ApiProperty({
    example: 5,
    description:
      'How many **active** people this plan covers — a column rather than a constant, so the tier line moves without a migration (§9). Checked when somebody is added or reactivated, never when they sign in: a business over its limit keeps working. Exposed so the staff screen can say "4 of 5" rather than letting an owner discover the ceiling by hitting a 409.',
  })
  maxUsers!: number;

  @ApiProperty({ type: String, nullable: true })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Tax identification number, printed on an invoice when set.',
  })
  taxId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Company registration number.',
  })
  rcNumber!: string | null;

  @ApiProperty({ type: String, nullable: true })
  logoUrl!: string | null;

  @ApiProperty({
    description:
      'Opening time, in minutes past midnight, in the organization’s timezone.',
    example: 480,
  })
  opensAt!: number;

  @ApiProperty({
    description:
      'Closing time, same units. Must be later than `opensAt`: no window crosses midnight, and a CHECK enforces it.',
    example: 1140,
  })
  closesAt!: number;

  @ApiProperty({
    type: [Number],
    description:
      'Days of the week the shop trades, 0 = Sunday. All seven by default. **Never empty**: an empty list means no day is a working day, which would lock every member of staff out, so the write path refuses it. This is the opposite of a *membership*’s `workingDays`, where empty means "follow the business" — a membership has something to fall back to and the organization does not.',
    example: [1, 2, 3, 4, 5, 6],
  })
  workingDays!: number[];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
