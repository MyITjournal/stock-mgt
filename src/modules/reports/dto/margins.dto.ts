import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class MarginsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Which price list to read prices from. Omitted, the default.',
  })
  @IsOptional()
  @IsUUID()
  tierId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

class MarginCategory {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

class Deal {
  @ApiProperty({ example: 13 })
  received!: number;

  @ApiProperty({ example: 12 })
  paidFor!: number;
}

class LastDelivery {
  @ApiProperty({ type: String, format: 'date-time' })
  receivedAt!: Date;

  @ApiProperty({
    description:
      'What one of this selling unit cost on that delivery, free goods included.',
  })
  cost!: number;

  @ApiProperty({
    type: () => Deal,
    nullable: true,
    description:
      'The free goods on that delivery as a vendor would say it — 13 for 12. Null when nothing came free.',
  })
  deal!: Deal | null;
}

class MarginOption {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Gold' })
  name!: string;
}

export class MarginRow {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'Dry Impact Roll-on' })
  productName!: string;

  @ApiProperty({
    type: () => MarginOption,
    nullable: true,
    description:
      'The option this row is for. A product with options has a row per active option (§24): each can have its own price, and its cost is that of the stock it holds. Null for a product without options.',
  })
  variant!: MarginOption | null;

  @ApiProperty({ type: String, nullable: true, example: '50ml' })
  size!: string | null;

  @ApiProperty({ type: () => MarginCategory, nullable: true })
  category!: MarginCategory | null;

  @ApiProperty({ format: 'uuid' })
  unitId!: string;

  @ApiProperty({ example: 'carton' })
  unitName!: string;

  @ApiProperty({ description: 'Base units in one of this unit.' })
  factor!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Today’s price for this unit on the chosen list. Null: no price, so no margin.',
  })
  price!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'What one of this unit costs: the average of the stock on hand, or — with none on hand — the last delivery (`costFrom`). Null when neither exists.',
  })
  cost!: number | null;

  @ApiProperty({
    enum: ['on_hand', 'last_delivery'],
    nullable: true,
    description: 'Where `cost` came from.',
  })
  costFrom!: 'on_hand' | 'last_delivery' | null;

  @ApiProperty({ description: 'Base units on hand, every location.' })
  onHand!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The price without VAT, less `cost`. Null without both.',
  })
  margin!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      '`margin` as a share of the price without VAT, in basis points. 740 is 7.4%.',
  })
  marginBps!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'What the stock on hand would make sold at this price: on hand × (price without VAT − cost), per counted-in unit, rounded once. Null with nothing on hand, or no price or cost.',
  })
  projectedProfit!: number | null;

  @ApiProperty({
    type: () => LastDelivery,
    nullable: true,
    description:
      'The newest delivery, shown beside the average so a new deal is visible at once. Not what the margin is measured against.',
  })
  lastDelivery!: LastDelivery | null;
}

class MarginTier {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Retail' })
  name!: string;
}

/** The whole list's stock on hand, sold at today's carton prices. */
class MarginsProjection {
  @ApiProperty({ description: 'What it would sell for, without VAT.' })
  revenue!: number;

  @ApiProperty({
    description: 'What it cost — the stock value of the products counted.',
  })
  cost!: number;

  @ApiProperty({
    description: '`revenue − cost`, rounded once from the exact figures.',
  })
  profit!: number;

  @ApiProperty({
    description: 'Profit as a share of revenue, in basis points.',
  })
  marginBps!: number;

  @ApiProperty({
    description:
      'Products with stock on hand but no price on this list — left out, and counted so a screen says so.',
  })
  unpriced!: number;
}

export class MarginsView {
  @ApiProperty({
    type: () => MarginTier,
    nullable: true,
    description: 'The price list the prices were read from.',
  })
  tier!: MarginTier | null;

  @ApiProperty({
    description:
      'Whether margins were measured without VAT. Off, the whole price is the shop’s.',
  })
  chargesVat!: boolean;

  @ApiProperty({
    type: () => [MarginRow],
    description:
      'One per product, in the biggest unit the till sells: thinnest margin first, then rows with no cost, then rows with no price.',
  })
  rows!: MarginRow[];

  @ApiProperty({
    type: () => MarginsProjection,
    description:
      'If everything on hand sold at today’s carton price on this list: a projection to plan by, never a record. Follows the category filter.',
  })
  projection!: MarginsProjection;
}
