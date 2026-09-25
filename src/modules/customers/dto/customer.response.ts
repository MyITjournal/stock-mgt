import { ApiProperty } from '@nestjs/swagger';

/**
 * What `GET /customers` and `GET /customers/:id` return.
 *
 * **This is the service's declared return type, not a description of it**
 * (DECISIONS.md §17).
 *
 * Nearly everything is nullable, and that is the market rather than sloppiness:
 * a customer is often a shop known by a first name and a phone number, recorded
 * mid-transaction by someone with a queue in front of them. Requiring a surname
 * or an address would mean the row never gets created and the debt is never
 * tracked. `firstName` is the one thing always present.
 */
export class CustomerView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'Ngozi' })
  firstName!: string;

  @ApiProperty({ type: String, nullable: true })
  middleName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Okafor' })
  lastName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+2348030000000' })
  phone!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Which price list this customer buys on. Null falls back to the default tier.',
  })
  priceTierId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}
