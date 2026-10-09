import { ApiProperty } from '@nestjs/swagger';

/**
 * One of a product's units, so a screen can say a count in base units the way
 * the shop does — "14 carton, 5 piece" (2026-10-09). Display only: nothing is
 * computed from it, and quantities stay whole base units everywhere.
 */
export class CountUnitView {
  @ApiProperty({ example: 'carton' })
  name!: string;

  @ApiProperty({ example: 24, description: 'Base units in one of these.' })
  factor!: number;
}

/** The product's units, smallest first — what fills a `CountUnitView[]`. */
export const COUNT_UNITS = {
  orderBy: { factor: 'asc' },
  select: { name: true, factor: true },
} as const;
