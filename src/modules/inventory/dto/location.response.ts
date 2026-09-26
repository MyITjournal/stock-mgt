import { ApiProperty } from '@nestjs/swagger';

/**
 * A place stock sits.
 *
 * **This is the service's declared return type, not a description of it**
 * (DECISIONS.md §17).
 *
 * Every organization starts with one, so stock can be received before anybody
 * has thought about warehouses. A business that only ever has one place never
 * has to open this screen.
 */
export class LocationView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'Main Store' })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({
    description:
      'Where a movement lands when the caller named no location. Exactly one is flagged: setting it here demotes whichever held it.',
  })
  isDefault!: boolean;

  @ApiProperty({ description: 'Display order in pickers. Ties break on name.' })
  sortOrder!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Soft delete, and only ever set on an empty location: movements point at it forever, so retiring one that still holds stock would strand that stock where nothing can see it.',
  })
  deletedAt!: Date | null;
}
