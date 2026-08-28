import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { IsMoney } from '../../../common/money/is-money.validator';

/**
 * Interim shape. Slice 5 replaces this with an invoice carrying multiple lines,
 * each snapshotting the price charged at the time of sale.
 */
export class CreateSaleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  /** Overrides the computed price x quantity when supplied. */
  @IsOptional()
  @IsMoney({ example: 750000, optional: true })
  total?: number;
}
