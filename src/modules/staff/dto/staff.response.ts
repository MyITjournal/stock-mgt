import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipStatus, OrgRole } from '@prisma/client';

/**
 * What the staff endpoints return.
 *
 * **These are the service's declared return types, not descriptions of them**
 * (DECISIONS.md §17).
 *
 * The shape of this list **depends on who is reading it**, and the optional
 * fields below are that, not an oversight. Reading the list is open to every
 * member — a rep needs to know who to hand a sale over to — but that purpose is
 * served by names and roles. `username` is *half of a credential* here: staff
 * sign in with one because most have no email address, and an owner can set
 * their password directly. Handing every cashier the login name of every
 * colleague, the owner included, had no reason to be there, so contact details
 * and each person's hours are withheld with it (§9).
 *
 * A field is **absent rather than null** for a reader who may not see it, the
 * same rule cost fields follow: null would say "this person has no username",
 * which is a different and untrue statement.
 */

class StaffUserView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Amina',
    description:
      'Required when an owner adds somebody through `/staff`, but the column is nullable because accounts can reach a membership by other routes.',
  })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Null for most staff — a cashier in this market usually has no working address, which is why `username` exists and why an owner resets their password for them. **Absent** for a reader who is not an owner or manager.',
  })
  email?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Stored qualified by the org slug (`amina@adebayo-stores`), which makes it globally unique for free. **Absent** for a reader who is not an owner or manager: it is half of a credential.',
  })
  username?: string | null;

  @ApiPropertyOptional({
    description:
      'Staff accounts are created **pre-verified** — a code would never arrive at an address the owner invented, and the owner vouching in person is the verification.',
  })
  isVerified?: boolean;
}

/** One person who works here. */
export class StaffMemberView {
  @ApiProperty({ format: 'uuid', description: 'The membership, not the user.' })
  id!: string;

  @ApiProperty({ enum: OrgRole, enumName: 'OrgRole' })
  role!: OrgRole;

  @ApiProperty({
    enum: MembershipStatus,
    enumName: 'MembershipStatus',
    description:
      'Removal is suspension: their name is on sales, payments and stock movements. It takes effect on their **next request**, not when their token expires, and it frees their seat.',
  })
  status!: MembershipStatus;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'This person’s own opening time, in minutes past midnight. **Null means inherit** the business hours, so a new hire is covered without anybody remembering. Absent for a reader who may not see it.',
  })
  opensAt?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  closesAt?: number | null;

  @ApiPropertyOptional({
    type: [Number],
    description:
      'Days this person works, 0 = Sunday. An **empty array means they follow the business** — the opposite of the organization’s own list, which may never be empty.',
  })
  workingDays?: number[];

  @ApiPropertyOptional({
    description:
      'Exempt from the window entirely. Owners are never locked out regardless.',
  })
  ignoresWorkingHours?: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: () => StaffUserView })
  user!: StaffUserView;
}

/** What resetting a password answers with. Deliberately not the password. */
export class StaffPasswordResetView {
  @ApiProperty({ example: 'Password updated. Tell them the new one.' })
  message!: string;
}
