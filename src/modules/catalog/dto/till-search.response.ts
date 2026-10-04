import { ApiProperty } from '@nestjs/swagger';

/** One unit the till may sell, already priced on the cart's price list. */
export class TillSearchUnit {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'carton' })
  name!: string;

  @ApiProperty({ example: 24, description: 'Base units in one of these.' })
  factor!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4_000_000,
    description:
      'Tax-inclusive, in kobo, on the tier asked for. Null when the unit has no price and the product no base price — the till refuses it rather than guess (§4).',
  })
  price!: number | null;

  @ApiProperty({
    description:
      'False means the price is the basePrice × factor fallback, which the till flags.',
  })
  isTierPrice!: boolean;
}

/**
 * A product as the till's search box needs it, and nothing more.
 *
 * **One request instead of three.** Picking a product used to cost a scan
 * attempt, a search, then a price lookup — each a round trip, one after the
 * other, about two seconds apiece on the hosted instance. This answers the
 * search *with* every sellable unit already priced on the cart's tier, while
 * the person is still typing, so choosing a suggestion adds it to the cart with
 * no request at all. Lean on purpose: no cost, no barcodes, no lots.
 */
export class TillSearchResult {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Peak 14g' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: '14g' })
  size!: string | null;

  @ApiProperty({ example: 'PEAK-14G' })
  sku!: string;

  @ApiProperty()
  trackStock!: boolean;

  @ApiProperty({
    format: 'uuid',
    description: 'The unit the till picks first — always one of `units`.',
  })
  defaultUnitId!: string;

  @ApiProperty({
    type: [TillSearchUnit],
    description: 'Only units sold at the till, smallest first.',
  })
  units!: TillSearchUnit[];
}
